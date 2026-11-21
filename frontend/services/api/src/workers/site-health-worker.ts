import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import {
  SITE_HEALTH_LANE,
  TaskQueue,
  type ClaimFilter,
  type SiteTask,
} from '../queue/task-queue.ts';
import { persistLinkMetrics } from '../site-health/link-metrics.ts';
import { persistArchitecture } from '../site-health/architecture.ts';
import { runAnalyze } from '../site-health/analyze-task.ts';
import { runDiscover } from '../site-health/discover-task.ts';
import { runSiteSetup } from '../site-health/site-setup-task.ts';
import { runFinalize } from '../site-health/finalize-task.ts';
import { runSiteTask, type SiteTaskWork } from '../site-health/site-task.ts';
import { SitePageFetcher } from '../site-health/page-fetch.ts';
import { runChangeIntel } from '../site-health/change-snapshot.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { recoverExpiredLeases } from '../site-health/lease-recovery.ts';
import {
  publishCancelledCrawls,
  reconcileAfterTask,
  reconcileCrawl,
  reconcileOverdue,
  reconcileStalled,
} from '../site-health/lifecycle.ts';
import { crawlCadences, type CrawlCadences } from '../site-health/refresh-cadence.ts';

type TransactionRun = Extract<SiteTaskWork, { kind: 'transaction' }>['run'];
export type PeersDue = () => Promise<boolean>;
const WORK: Readonly<Record<string, SiteTaskWork>> = {
  analyze: { kind: 'acquire', run: runAnalyze },
  discover: { kind: 'acquire', run: runDiscover },
  site_setup: { kind: 'acquire', run: runSiteSetup },
  finalize: { kind: 'acquire', run: runFinalize },
  change_intel: { kind: 'transaction', run: runChangeIntel },
  link_metrics: { kind: 'transaction', run: persistLinkMetrics },
  architecture: { kind: 'transaction', run: persistArchitecture },
};
const logger = getLogger('app.workers.site_health_worker');
export class SiteHealthWorker {
  readonly db: Database;
  readonly owner: string;
  readonly settings: ReturnType<typeof siteWorkerSettings>;
  readonly queue: TaskQueue<'site_crawl_tasks'>;
  readonly fetcher: SitePageFetcher;
  readonly #work: Readonly<Record<string, SiteTaskWork>>;
  readonly taskScope?: { workspaceId: string; crawlId: string };
  readonly #where?: ClaimFilter;
  readonly signal?: AbortSignal;
  readonly #cadence: CrawlCadences;
  #upkeep: Promise<number> | null = null;
  readonly #upkeepFailures: unknown[] = [];
  #nextRecovery = 0;
  #nextMaintenance = 0;
  readonly #reconciles = new Map<string, Promise<void>>();
  constructor(
    db: Database,
    options: {
      owner?: string;
      settings?: ReturnType<typeof siteWorkerSettings>;
      executors?: Readonly<Record<string, TransactionRun>>;
      fetcher?: SitePageFetcher;
      taskScope?: { workspaceId: string; crawlId: string };
      signal?: AbortSignal;
    } = {},
  ) {
    this.db = db;
    this.taskScope = options.taskScope;
    if (options.taskScope) {
      const { workspaceId, crawlId } = options.taskScope;
      this.#where = (column) =>
        sql<boolean>`${column('workspace_id')} = ${workspaceId} and ${column('crawl_id')} = ${crawlId}`;
    }
    this.signal = options.signal;
    this.owner = options.owner ?? `site-worker-ts-${randomUUID().slice(0, 12)}`;
    this.settings = options.settings ?? siteWorkerSettings();
    this.queue = new TaskQueue(db, SITE_HEALTH_LANE, { leaseTtlSeconds: this.settings.lease });
    this.#cadence = crawlCadences(this.settings.scoreRefresh);
    // One fetcher for the worker: robots caching and per-host pacing span every task.
    this.fetcher = options.fetcher ?? new SitePageFetcher(db);
    const replaced = Object.entries(options.executors ?? {}).map(
      ([kind, run]): [string, SiteTaskWork] => [kind, { kind: 'transaction', run }],
    );
    this.#work = { ...WORK, ...Object.fromEntries(replaced) };
  }
  async runOnce(limit = this.settings.concurrency, canAdmit: () => boolean = () => true) {
    return this.#withUpkeep(async () =>
      canAdmit() ? this.#claimAndExecute(limit, { refillWhile: () => false }) : 0,
    );
  }
  async drain(
    limit = this.settings.concurrency,
    canAdmit: () => boolean = () => true,
    peersDue?: PeersDue,
  ) {
    return this.#withUpkeep(async () =>
      canAdmit() ? this.#claimAndExecute(limit, { refillWhile: canAdmit, peersDue }) : 0,
    );
  }
  async #claimAndExecute(
    limit: number,
    options: { refillWhile: () => boolean; peersDue?: PeersDue },
  ) {
    const windowMs = this.settings.claimWindow * 1000;
    let windowEnd = performance.now() + windowMs;
    const refill = async () => {
      if (!options.refillWhile() || this.signal?.aborted) return false;
      if (performance.now() < windowEnd) return true;
      if (!options.peersDue || (await this.#peersDue(options.peersDue))) return false;
      windowEnd = performance.now() + windowMs;
      return options.refillWhile() && !this.signal?.aborted;
    };
    const inFlight = new Set<Promise<void>>();
    const failures: unknown[] = [];
    let claimed = 0;
    const claim = async () => {
      let tasks: SiteTask[];
      try {
        tasks = await this.queue.claim({
          owner: this.owner,
          kinds: policy.site_health.ts_owned_task_kinds,
          limit: limit - inFlight.size,
          where: this.#where,
        });
      } catch (error) {
        failures.push(error);
        return;
      }
      claimed += tasks.length;
      for (const task of tasks) {
        const running: Promise<void> = this.#settle(task)
          .then(() => undefined)
          .catch((error: unknown) => {
            failures.push(error);
          })
          .finally(() => inFlight.delete(running));
        inFlight.add(running);
      }
    };
    await claim();
    while (inFlight.size) {
      await Promise.race(inFlight); // NOSONAR -- Wait for the next free slot.
      if (failures.length) continue;
      if (!inFlight.size) await this.#reconciled(); // NOSONAR -- Successors first.
      if (await refill()) await claim(); // NOSONAR -- One refill per settlement.
    }
    if (failures.length) throw failures[0];
    return claimed;
  }
  async #peersDue(peersDue: PeersDue) {
    try {
      return await peersDue();
    } catch (error) {
      logger.exception('site health peer probe failed', error);
      return true;
    }
  }
  nextDue(): Promise<Date | null> {
    const scope = this.taskScope;
    return this.queue.nextDue(
      policy.site_health.ts_owned_task_kinds,
      scope ? sql`workspace_id = ${scope.workspaceId} and crawl_id = ${scope.crawlId}` : undefined,
    );
  }
  async #withUpkeep(body: () => Promise<number>) {
    this.#kickUpkeep();
    const timer = setInterval(() => this.#kickUpkeep(), Math.max(50, this.settings.poll * 1000));
    let result: number;
    try {
      result = await body();
    } finally {
      clearInterval(timer);
      await this.#upkeep;
      await this.#reconciled();
    }
    const [failure] = this.#upkeepFailures.splice(0);
    if (failure) throw failure;
    return result;
  }
  #kickUpkeep() {
    if (this.#upkeep) return;
    const now = Date.now();
    if (now < this.#nextRecovery && now < this.#nextMaintenance) return;
    this.#upkeep = this.#runUpkeep()
      .catch((error: unknown) => {
        this.#upkeepFailures.push(error);
        return 0;
      })
      .finally(() => {
        this.#upkeep = null;
      });
  }
  async #upkeepPass() {
    this.#kickUpkeep();
    return (await this.#upkeep) ?? 0;
  }
  async #runUpkeep() {
    const reclaimed = Date.now() >= this.#nextRecovery ? await this.#recover() : 0;
    if (Date.now() >= this.#nextMaintenance) await this.#maintain();
    return reclaimed;
  }
  async #recover() {
    const result = await recoverExpiredLeases(
      this.db,
      this.settings.reclaimBatch,
      new Date(),
      this.taskScope,
    );
    this.#nextRecovery =
      result.reclaimed === this.settings.reclaimBatch
        ? 0
        : Date.now() + Math.max(50, this.settings.poll * 1000);
    for (const crawl of result.failedCrawls) {
      const reconcile = () => reconcileCrawl(this.db, crawl.workspaceId, crawl.crawlId);
      await this.#guard('recovered crawl reconcile failed', reconcile); // NOSONAR -- One crawl lock at a time, each in its own transaction.
    }
    return result.reclaimed;
  }
  async #maintain() {
    const lifecycle = this.settings.lifecycle;
    try {
      if (this.taskScope) {
        const { workspaceId, crawlId } = this.taskScope;
        await this.#guard('scoped crawl reconcile failed', async () => {
          const crawl = await this.db
            .selectFrom('site_crawls')
            .select('admitted_url_count')
            .where('workspace_id', '=', workspaceId)
            .where('id', '=', crawlId)
            .executeTakeFirst();
          const pages = crawl?.admitted_url_count;
          const refreshScore = this.#cadence.score.admits(crawlId, { pages });
          await reconcileCrawl(this.db, workspaceId, crawlId, { refreshScore });
        });
        return;
      }
      await this.#guard('stalled crawl reconcile failed', () =>
        reconcileStalled(this.db, lifecycle),
      );
      await this.#guard('overdue crawl reconcile failed', () =>
        reconcileOverdue(this.db, lifecycle),
      );
      await this.#guard('cancelled crawl publication failed', () =>
        publishCancelledCrawls(this.db, lifecycle.batch),
      );
    } finally {
      this.#nextMaintenance = Date.now() + Math.max(50, this.settings.backstopInterval * 1000);
    }
  }
  async #guard(message: string, body: () => Promise<unknown>) {
    try {
      await body();
    } catch (error) {
      logger.exception(message, error);
    }
  }
  async runUntilIdle(signal: AbortSignal, budgetSeconds = this.settings.drainBudget) {
    if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0)
      throw new Error('Site Health drain budget must be positive and finite');
    const deadline = performance.now() + budgetSeconds * 1000;
    const admit = () => !signal.aborted && performance.now() < deadline;
    return this.#withUpkeep(async () => {
      let total = 0;
      while (admit()) {
        const count = await this.#claimAndExecute(this.settings.concurrency, {
          refillWhile: admit,
        });
        total += count;
        if (!count && !(await this.#upkeepPass())) break; // NOSONAR -- Recovery batches drain in turn.
      }
      return total;
    });
  }
  async execute(claimed: SiteTask) {
    const { reconciled } = await this.#settle(claimed);
    await reconciled;
  }
  async #settle(claimed: SiteTask) {
    const kind = claimed.task_kind;
    const work: SiteTaskWork = Object.hasOwn(this.#work, kind)
      ? this.#work[kind]!
      : {
          kind: 'transaction',
          run: () => Promise.reject(new Error(`Site Health task '${kind}' has no executor`)),
        };
    await runSiteTask(
      {
        db: this.db,
        owner: this.owner,
        queue: this.queue,
        fetcher: this.fetcher,
        settings: this.settings,
        signal: this.signal,
      },
      claimed,
      work,
    );
    return { reconciled: work.kind === 'acquire' ? this.#reconcile(claimed) : Promise.resolve() };
  }
  #reconcile(task: SiteTask) {
    const previous = this.#reconciles.get(task.crawl_id) ?? Promise.resolve();
    const next = previous.then(() =>
      this.#guard('site health crawl reconcile failed', () =>
        reconcileAfterTask(this.db, task, this.#cadence),
      ),
    );
    this.#reconciles.set(task.crawl_id, next);
    void next.then(() => {
      if (this.#reconciles.get(task.crawl_id) === next) this.#reconciles.delete(task.crawl_id);
    });
    return next;
  }
  async #reconciled() {
    while (this.#reconciles.size) await Promise.all(this.#reconciles.values()); // NOSONAR -- Chains may grow while awaited.
  }
}
