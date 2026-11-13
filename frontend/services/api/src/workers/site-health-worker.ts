/**
 * Disjoint SiteCrawlTask claims handed to the one Site Health task runner, and
 * the crawl lifecycle: each settled discovery or analysis task is reconciled,
 * and every pass runs the stalled, overdue and cancelled crawl backstops.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { SITE_HEALTH_LANE, TaskQueue, type SiteTask } from '../queue/task-queue.ts';
import { persistLinkMetrics } from '../site-health/link-metrics.ts';
import { persistArchitecture } from '../site-health/architecture.ts';
import { runAnalyze } from '../site-health/analyze-task.ts';
import { runDiscover } from '../site-health/discover-task.ts';
import { runSiteSetup } from '../site-health/site-setup-task.ts';
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
  ScoreRefreshCadence,
} from '../site-health/lifecycle.ts';

type TransactionRun = Extract<SiteTaskWork, { kind: 'transaction' }>['run'];
/**
 * Every kind the worker runs. Acquiring kinds own their transactions and mark
 * themselves running; the rest run inside the runner's transaction.
 */
const WORK: Readonly<Record<string, SiteTaskWork>> = {
  analyze: { kind: 'acquire', run: runAnalyze },
  discover: { kind: 'acquire', run: runDiscover },
  site_setup: { kind: 'acquire', run: runSiteSetup },
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
  readonly signal?: AbortSignal;
  readonly #cadence: ScoreRefreshCadence;
  #recovery: Promise<number> | null = null;
  #nextRecovery = 0;
  #maintenance: Promise<void> | null = null;
  #nextMaintenance = 0;
  constructor(
    db: Database,
    options: {
      owner?: string;
      settings?: ReturnType<typeof siteWorkerSettings>;
      /** Replacement transaction kinds, by task kind. */
      executors?: Readonly<Record<string, TransactionRun>>;
      fetcher?: SitePageFetcher;
      taskScope?: { workspaceId: string; crawlId: string };
      signal?: AbortSignal;
    } = {},
  ) {
    this.db = db;
    this.taskScope = options.taskScope;
    this.signal = options.signal;
    this.owner = options.owner ?? `site-worker-ts-${randomUUID().slice(0, 12)}`;
    this.settings = options.settings ?? siteWorkerSettings();
    this.queue = new TaskQueue(db, SITE_HEALTH_LANE, { leaseTtlSeconds: this.settings.lease });
    this.#cadence = new ScoreRefreshCadence(this.settings.scoreRefresh);
    // One fetcher for the worker: robots caching and per-host pacing span every task.
    this.fetcher = options.fetcher ?? new SitePageFetcher(db);
    const replaced = Object.entries(options.executors ?? {}).map(
      ([kind, run]): [string, SiteTaskWork] => [kind, { kind: 'transaction', run }],
    );
    this.#work = { ...WORK, ...Object.fromEntries(replaced) };
  }
  /** One claim pass: up to `limit` tasks, each settled before returning. */
  async runOnce(limit = this.settings.concurrency, canAdmit: () => boolean = () => true) {
    await this.#recover();
    await this.#maintain();
    if (!canAdmit()) return 0;
    return this.#claimAndExecute(limit, () => false);
  }
  /** Like `runOnce`, but refills each freed slot while the caller admits, within the claim window. */
  async drain(limit = this.settings.concurrency, canAdmit: () => boolean = () => true) {
    await this.#recover();
    await this.#maintain();
    if (!canAdmit()) return 0;
    return this.#claimAndExecute(limit, canAdmit);
  }
  async #scope() {
    if (!this.taskScope) return undefined;
    const { workspaceId, crawlId } = this.taskScope;
    const rows = await this.db
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('crawl_id', '=', crawlId)
      .execute();
    return { workspaceId, taskIds: rows.map((row) => row.id) };
  }
  /**
   * Keep up to `limit` tasks in flight: each settlement frees a slot that the
   * next claim refills, so one slow fetch never idles the others. Successors a
   * task enqueues become claimable on the next refill. Refills stop once the
   * caller stops admitting or the claim window ends; claimed work always settles.
   */
  async #claimAndExecute(limit: number, refillWhile: () => boolean) {
    const windowEnd = performance.now() + this.settings.claimWindow * 1000;
    const refill = () => refillWhile() && !this.signal?.aborted && performance.now() < windowEnd;
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
          scope: await this.#scope(),
        });
      } catch (error) {
        // In-flight work still settles before the failure surfaces.
        failures.push(error);
        return;
      }
      claimed += tasks.length;
      for (const task of tasks) {
        const running: Promise<void> = this.execute(task)
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
      if (!failures.length && refill()) await claim(); // NOSONAR -- One refill per settlement.
    }
    if (failures.length) throw failures[0];
    return claimed;
  }
  /** When the earliest task becomes available (deferred analysis, retry backoff) or its lease expires. */
  nextDue(): Promise<Date | null> {
    const scope = this.taskScope;
    return this.queue.nextDue(
      policy.site_health.ts_owned_task_kinds,
      scope ? sql`workspace_id = ${scope.workspaceId} and crawl_id = ${scope.crawlId}` : undefined,
    );
  }
  async #recover() {
    // Another slot owns the in-flight pass; this slot keeps claiming instead of waiting.
    if (this.#recovery) return 0;
    if (Date.now() < this.#nextRecovery) return 0;
    this.#recovery = recoverExpiredLeases(
      this.db,
      this.settings.reclaimBatch,
      new Date(),
      this.taskScope,
    )
      .then(async (result) => {
        this.#nextRecovery =
          result.reclaimed === this.settings.reclaimBatch
            ? 0
            : Date.now() + Math.max(50, this.settings.poll * 1000);
        // A lease recovered at its attempt ceiling settles a task no executor will reconcile.
        for (const crawl of result.failedCrawls) {
          const reconcile = () => reconcileCrawl(this.db, crawl.workspaceId, crawl.crawlId);
          await this.#guard('recovered crawl reconcile failed', reconcile); // NOSONAR -- One crawl lock at a time, each in its own transaction.
        }
        return result.reclaimed;
      })
      .finally(() => {
        this.#recovery = null;
      });
    return this.#recovery;
  }
  /** Crawl backstops, at most once per interval across this worker's slots. */
  async #maintain() {
    if (this.#maintenance) return;
    if (Date.now() < this.#nextMaintenance) return;
    const lifecycle = this.settings.lifecycle;
    this.#maintenance = (async () => {
      if (this.taskScope) {
        const { workspaceId, crawlId } = this.taskScope;
        await this.#guard('scoped crawl reconcile failed', () =>
          reconcileCrawl(this.db, workspaceId, crawlId),
        );
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
    })().finally(() => {
      // A scoped crawl's reconcile is its own finalizer; global backstops are a slower safety net.
      const interval = this.taskScope ? this.settings.poll : this.settings.backstopInterval;
      this.#nextMaintenance = Date.now() + Math.max(50, interval * 1000);
      this.#maintenance = null;
    });
    return this.#maintenance;
  }
  /** One failed backstop must not suppress the others or the claim loop. */
  async #guard(message: string, body: () => Promise<unknown>) {
    try {
      await body();
    } catch (error) {
      logger.exception(message, error);
    }
  }
  /** Stop new claims at the deadline; finish bounded in-flight work and close cleanly. */
  async runUntilIdle(signal: AbortSignal, budgetSeconds = this.settings.drainBudget) {
    if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0)
      throw new Error('Site Health drain budget must be positive and finite');
    const deadline = performance.now() + budgetSeconds * 1000;
    let total = 0;
    while (!signal.aborted && performance.now() < deadline) {
      const recovered = await this.#recover();
      // Maintenance runs even on an empty queue, so a drain still finalizes stalled crawls.
      await this.#maintain();
      if (signal.aborted || performance.now() >= deadline) break;
      const count = await this.#claimAndExecute(
        this.settings.concurrency,
        () => !signal.aborted && performance.now() < deadline,
      );
      total += count;
      if (!count && recovered < this.settings.reclaimBatch) break;
    }
    return total;
  }
  /** Run one claimed task through the Site Health task runner. */
  async execute(claimed: SiteTask) {
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
    // After the settlement commits; the stalled backstop covers a crash in between.
    if (work.kind === 'acquire')
      await this.#guard('site health crawl reconcile failed', () =>
        reconcileAfterTask(this.db, claimed, this.#cadence),
      );
  }
}
