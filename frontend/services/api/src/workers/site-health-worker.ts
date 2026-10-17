/**
 * Disjoint SiteCrawlTask claims, heartbeat, atomic evidence/successor
 * acknowledgement, and the crawl lifecycle: each settled discovery or analysis
 * task is reconciled, and every pass runs the stalled, overdue and cancelled
 * crawl backstops.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { TaskQueue, type SiteTask } from '../queue/task-queue.ts';
import { maintainLease, leaseSignal } from '../queue/heartbeat.ts';
import { persistLinkMetrics } from '../site-health/link-metrics.ts';
import { persistArchitecture } from '../site-health/architecture.ts';
import { runAnalyze } from '../site-health/analyze-task.ts';
import { runDiscover } from '../site-health/discover-task.ts';
import { runSiteSetup } from '../site-health/site-setup-task.ts';
import { siteTaskSettings, type SiteTaskContext } from '../site-health/site-task.ts';
import { SitePageFetcher } from '../site-health/page-fetch.ts';
import { runChangeIntel } from '../site-health/change-snapshot.ts';
import { siteWorkerSettings } from '../site-health/runtime.ts';
import { lockSiteTask, type Crawl } from '../site-health/task-fence.ts';
import { TaskCancelledError } from './executor.ts';
import { recoverExpiredLeases } from '../site-health/lease-recovery.ts';
import {
  publishCancelledCrawls,
  reconcileAfterTask,
  reconcileCrawl,
  reconcileOverdue,
  reconcileStalled,
  ScoreRefreshCadence,
} from '../site-health/lifecycle.ts';

type SiteExecutor = (db: Database, crawl: Crawl, task: SiteTask) => Promise<unknown>;
const executors: Record<string, SiteExecutor> = {
  change_intel: runChangeIntel,
  link_metrics: persistLinkMetrics,
  architecture: persistArchitecture,
};
/** Kinds that acquire over the network: each owns its transactions and marks itself running. */
const acquisition: Record<string, (ctx: SiteTaskContext, task: SiteTask) => Promise<void>> = {
  analyze: runAnalyze,
  discover: runDiscover,
  site_setup: runSiteSetup,
};
const logger = getLogger('app.workers.site_health_worker');
/** Uniform jitter in [0, seconds), millisecond resolution. */
const jitter = (seconds: number) => randomInt(Math.max(1, Math.round(seconds * 1000))) / 1000;
const failureDetail = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 2000) : 'Site Health task failed';
function conflict(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && ['40001', '40P01', '55P03'].includes(code);
}
export class SiteHealthWorker {
  readonly db: Database;
  readonly owner: string;
  readonly settings: ReturnType<typeof siteWorkerSettings>;
  readonly queue: TaskQueue<'site_crawl_tasks'>;
  readonly executors: Record<string, SiteExecutor>;
  readonly acquisition: SiteTaskContext;
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
      executors?: Record<string, SiteExecutor>;
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
    this.executors = options.executors ?? executors;
    this.queue = new TaskQueue(db, { leaseTtlSeconds: this.settings.lease }, 'site_crawl_tasks');
    this.#cadence = new ScoreRefreshCadence(this.settings.scoreRefresh);
    // Each acquisition checks twice; a short-lived grant spares four queries per check.
    // One fetcher for the worker: robots caching and per-host pacing span every task.
    this.acquisition = {
      db,
      owner: this.owner,
      fetcher: options.fetcher ?? new SitePageFetcher(db),
      settings: siteTaskSettings(),
    };
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
          // One crawl lock at a time, each in its own transaction.
          await this.#guard('recovered crawl reconcile failed', reconcile); // NOSONAR
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
  async execute(claimed: SiteTask) {
    const acquire = Object.hasOwn(acquisition, claimed.task_kind)
      ? acquisition[claimed.task_kind]
      : undefined;
    if (acquire) {
      await this.#leased(claimed, async (signal) => {
        await acquire({ ...this.acquisition, signal }, claimed);
      });
      // After the settlement commits; the stalled backstop covers a crash in between.
      await this.#guard('site health crawl reconcile failed', () =>
        reconcileAfterTask(this.db, claimed, this.#cadence),
      );
      return;
    }
    if (!(await this.queue.markRunning(claimed.id, this.owner))) return;
    await this.#leased(claimed, (signal) => this.#executeInTransaction(claimed, signal));
  }
  /** Heartbeat the lease for the whole body; a failure settles the task. */
  async #leased(claimed: SiteTask, body: (signal: AbortSignal) => Promise<void>) {
    const heartbeat = maintainLease(
      () => this.queue.heartbeat(claimed.id, this.owner, claimed.workspace_id),
      this.settings.heartbeat * 1000,
      (error) => logger.exception('heartbeat failed', error, { task_id: claimed.id }),
    );
    try {
      await body(leaseSignal(heartbeat.signal, this.signal));
    } catch (error) {
      if (!heartbeat.signal.aborted && !(error instanceof TaskCancelledError)) {
        logger.exception('site health task failed', error, { task_id: claimed.id });
        try {
          await this.fail(claimed, error);
        } catch (error_) {
          // A sibling may still hold the crawl lock fail() needs. Contention must
          // not disable the lane or let lease recovery charge an attempt.
          if (!conflict(error_)) throw error_;
          await this.#releaseContended(claimed, error);
        }
      }
    } finally {
      await heartbeat.stop();
    }
  }
  async #executeInTransaction(claimed: SiteTask, signal: AbortSignal) {
    await this.db.transaction().execute(async (trx) => {
      signal.throwIfAborted();
      const { crawl, task } = await lockSiteTask(trx, claimed, this.owner, 'fence');
      const executor = Object.hasOwn(this.executors, task.task_kind)
        ? this.executors[task.task_kind]
        : undefined;
      if (!executor) throw new Error(`Site Health task '${task.task_kind}' has no executor`);
      await executor(trx, crawl, task);
      signal.throwIfAborted();
      await lockSiteTask(trx, claimed, this.owner, 'acknowledge');
      await trx
        .updateTable('site_crawl_tasks')
        .set({
          status: 'succeeded',
          attempt_count: task.attempt_count + 1,
          completed_at: new Date(),
          updated_at: new Date(),
          error_code: '',
          error_detail: '',
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
        })
        .where('id', '=', task.id)
        .where('workspace_id', '=', task.workspace_id)
        .execute();
    });
  }
  /**
   * Release this worker's lease for a contention retry without the crawl lock:
   * only the task row is written, so it cannot contend again. Past the
   * conflict bound the lease is left for recovery to settle at expiry.
   */
  async #releaseContended(claimed: SiteTask, error: unknown) {
    const now = new Date();
    await this.db
      .updateTable('site_crawl_tasks')
      .set((eb) => ({
        status: 'retry_wait',
        conflict_count: eb('conflict_count', '+', 1),
        updated_at: now,
        available_at: new Date(now.getTime() + this.#conflictDelay() * 1000),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        error_code: 'db_conflict',
        error_detail: failureDetail(error),
      }))
      .where('id', '=', claimed.id)
      .where('workspace_id', '=', claimed.workspace_id)
      .where('lease_owner', '=', this.owner)
      .where('status', '=', 'running')
      .where('conflict_count', '<', this.settings.conflictMax)
      .execute();
  }
  #conflictDelay() {
    return this.settings.conflictBase + jitter(this.settings.conflictJitter);
  }
  async fail(claimed: SiteTask, error: unknown) {
    await this.db.transaction().execute(async (trx) => {
      let held: Awaited<ReturnType<typeof lockSiteTask>>;
      try {
        held = await lockSiteTask(trx, claimed, this.owner);
      } catch (error_) {
        if (error_ instanceof TaskCancelledError) return;
        throw error_;
      }
      const { task } = held;
      const settings = this.settings;
      const contention = conflict(error);
      const conflicts = task.conflict_count + Number(contention);
      const attempt = task.attempt_count + Number(!contention);
      const retry = contention ? conflicts <= settings.conflictMax : attempt < task.max_attempts;
      const delay = contention
        ? this.#conflictDelay()
        : Math.min(settings.retryMax, settings.retryBase * 2 ** Math.max(0, attempt - 1)) +
          jitter(settings.retryJitter);
      const now = new Date();
      await trx
        .updateTable('site_crawl_tasks')
        .set({
          status: retry ? 'retry_wait' : 'failed',
          conflict_count: conflicts,
          attempt_count: attempt,
          completed_at: retry ? null : now,
          updated_at: now,
          available_at: new Date(now.getTime() + delay * 1000),
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          error_code: contention ? 'db_conflict' : 'task_failed',
          error_detail: failureDetail(error),
        })
        .where('id', '=', task.id)
        .where('workspace_id', '=', task.workspace_id)
        .execute();
    });
  }
}
