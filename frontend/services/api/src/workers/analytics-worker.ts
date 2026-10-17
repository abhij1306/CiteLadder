/**
 * The analytics worker: claims the kinds the analytics catalog
 * (`config/connected-data.ts`) owns and runs each through its executor.
 *
 * Owns the analytics queue lifecycle: the claim
 * commits before any work, a row already terminal at claim time is never
 * dispatched, the lease is marked running and heartbeated while the executor
 * runs, and one locked finalize per dispatch is the only terminal writer. It
 * re-checks owner and status (a lost lease or a terminal row writes nothing)
 * and counts the attempt exactly once. Bounded lease recovery and durable
 * terminal compensation run before every claim, including an empty drain.
 */
import { randomBytes } from 'node:crypto';
import { crawlLogRollupRefresh } from '../crawl-logs/rollup.ts';
import { refreshTrafficInsights } from '../crawl-logs/insights.ts';
import { crawlLogPull } from '../crawl-logs/pull.ts';
import {
  botIpRangeRefresh,
  botRequestRetentionSweep,
  crawlLogUploadAbandonSweep,
} from '../crawl-logs/maintenance.ts';
import { sql } from 'kysely';
import { recoverAnalyticsLeases } from '../queue/analytics-recovery.ts';
import { maintainLease } from '../queue/heartbeat.ts';
import { competitorDiscovery } from '../commerce/discovery.ts';
import { compensateTerminalTasks } from './terminal-compensation.ts';

import { policy, type WorkerSettings } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { TaskQueue, type QueueTask, type ClaimScope } from '../queue/task-queue.ts';
import { classifyReferrals } from '../referrals/classify.ts';
import { ingestReferrals } from '../referrals/ingest.ts';
import { referralRetentionSweep } from '../referrals/retention.ts';
import { refreshAiReferralsSnapshot } from '../referrals/snapshot.ts';
import {
  TaskCancelledError,
  TerminalExecutorError,
  type Executor,
  type TaskSettlement,
} from './executor.ts';
import { projectPerformanceRange, refreshTrafficSnapshot } from '../traffic/snapshot.ts';
import { recomputeDemand } from '../demand/snapshot.ts';
import { refreshOpportunities } from '../opportunities/refresh.ts';
import { verifyImplementationEvents } from '../opportunities/verification.ts';
import { projectCatalog } from '../commerce/projection.ts';
import { publishInternalLinks } from '../site-health/internal-link-publish.ts';
import { acquireResearch } from '../search-intelligence/executor.ts';
import { internalLinkJudge } from '../site-health/internal-link-judgments.ts';
import { sourcePageInspector } from '../source-pages/inspector.ts';
import { answerPerception } from '../perception/executor.ts';
import { factVerification } from '../perception/fact-verification.ts';

const logger = getLogger('workers.analytics');
const { statuses, terminal } = policy.task_queue;
const ERROR_DETAIL_LIMIT = 2000;

/** Kind dispatch: exactly the kinds TypeScript owns. */
export const EXECUTORS: Readonly<Record<string, Executor>> = {
  ai_traffic_insights_refresh: refreshTrafficInsights,
  crawl_log_rollup_refresh: crawlLogRollupRefresh,
  crawl_log_pull: crawlLogPull(),
  bot_ip_range_refresh: botIpRangeRefresh(),
  bot_request_retention_sweep: botRequestRetentionSweep,
  crawl_log_upload_abandon_sweep: crawlLogUploadAbandonSweep,
  commerce_competitor_discovery: competitorDiscovery(),
  search_intelligence_acquisition: acquireResearch,
  source_page_inspection: sourcePageInspector(),
  internal_link_judgment: internalLinkJudge(),
  internal_link_publish: publishInternalLinks,
  ingest_referrals: ingestReferrals,
  classify_referrals: classifyReferrals,
  ai_referrals_snapshot_refresh: refreshAiReferralsSnapshot,
  referral_retention_sweep: referralRetentionSweep,
  traffic_snapshot_refresh: refreshTrafficSnapshot,
  performance_range_projection: projectPerformanceRange,
  demand_snapshot_refresh: recomputeDemand,
  opportunity_refresh: refreshOpportunities,
  opportunity_verification: verifyImplementationEvents,
  commerce_catalog_projection: projectCatalog,
  answer_perception: answerPerception(),
  fact_verification: factVerification(),
};

/** A claimed kind with no executor: a deploy bug, failed without retries. */
class ExecutorNotWiredError extends Error {}

const detail = (error: Error) => [...String(error.message)].slice(0, ERROR_DETAIL_LIMIT).join('');

function taskOutcome(
  error: Error | null,
  attempt: number,
  maxAttempts: number,
  now: Date,
  retryDelaySeconds: number,
) {
  if (error === null)
    return { status: statuses.succeeded, completed_at: now, error_code: '', error_detail: '' };
  if (error instanceof ExecutorNotWiredError || error instanceof TerminalExecutorError)
    return {
      status: statuses.failed,
      completed_at: now,
      error_code:
        error instanceof TerminalExecutorError
          ? error.code
          : policy.analytics.executor_not_wired_error,
      error_detail: detail(error),
    };
  if (attempt < maxAttempts)
    return {
      status: statuses.retry_wait,
      available_at: new Date(now.getTime() + retryDelaySeconds * 1000),
      error_code: policy.analytics.retry_error,
      error_detail: detail(error),
    };
  return {
    status: statuses.failed,
    completed_at: now,
    error_code: policy.task_queue.max_attempts_error,
    error_detail: detail(error),
  };
}

export class AnalyticsWorker {
  readonly owner: string;
  readonly #db: Database;
  readonly #queue: TaskQueue;
  readonly #settings: WorkerSettings;
  readonly #executors: Readonly<Record<string, Executor>>;
  readonly #scope?: ClaimScope;
  readonly #signal?: AbortSignal;

  constructor(
    db: Database,
    settings: WorkerSettings,
    options: {
      owner?: string;
      executors?: Readonly<Record<string, Executor>>;
      taskScope?: ClaimScope;
      signal?: AbortSignal;
    } = {},
  ) {
    this.#db = db;
    this.#settings = settings;
    this.#queue = new TaskQueue(db, {
      leaseTtlSeconds: settings.leaseTtlSeconds,
      leaseTtlSecondsByKind: settings.leaseTtlSecondsByKind,
    });
    this.#executors = options.executors ?? EXECUTORS;
    this.#scope = options.taskScope;
    this.#signal = options.signal;
    this.owner = options.owner ?? `analytics-worker-ts-${randomBytes(6).toString('hex')}`;
  }

  /** Claim one row of a TypeScript-owned kind and run it; the count run. */
  async runOnce(): Promise<number> {
    if (this.#signal?.aborted) return 0;
    await recoverAnalyticsLeases(this.#db, this.#settings.leaseReclaimBatchSize, this.#scope);
    // Compensation is secondary: its failure must not block claiming new work.
    await compensateTerminalTasks(this.#db, this.#scope).catch((error: unknown) =>
      logger.exception('analytics_terminal_compensation_failed', error),
    );
    if (this.#signal?.aborted) return 0;
    const rows = await this.#queue.claim({
      owner: this.owner,
      kinds: this.#kinds(),
      scope: this.#scope,
    });
    for (const row of rows) await this.#execute(row);
    return rows.length;
  }

  /** When the earliest claimable task this worker owns becomes due, for the runner lane. */
  nextDue(): Promise<Date | null> {
    return this.#queue.nextDue(this.#kinds());
  }

  #kinds(): readonly string[] {
    return this.#scope ? Object.keys(this.#executors) : policy.analytics.ts_owned_task_kinds;
  }

  /** Drain until a claim returns nothing (tests and one-shot runs). */
  async runUntilIdle(maxBatches = 1000, signal?: AbortSignal): Promise<number> {
    let total = 0;
    const deadline = performance.now() + this.#settings.drainBudgetSeconds * 1000;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      if (signal?.aborted || performance.now() >= deadline) break;
      const ran = await this.runOnce();
      if (ran === 0) break;
      total += ran;
    }
    return total;
  }

  async #execute(claimed: QueueTask): Promise<void> {
    let started = false;
    try {
      // Cooperative cancel at the boundary: a row that turned terminal between
      // enqueue and claim is never dispatched.
      if (await this.#queue.isTerminal(claimed.id)) return;
      if (!(await this.#queue.markRunning(claimed.id, this.owner, claimed.attempt_count))) return;
      started = true;
      await this.#finalize(claimed, await this.#run(claimed));
    } catch (error) {
      logger.exception('analytics_task_crashed', error, { task_id: claimed.id });
      // A failed transition leaves a leased claim for recovery; no executor
      // attempt or partial publication occurred.
      if (started) await this.#finalize(claimed, error as Error).catch(() => undefined);
    }
  }

  /** Run the executor under a heartbeat; the error it raised, if any. */
  async #run(claimed: QueueTask): Promise<Error | TaskSettlement | null> {
    const executor = Object.hasOwn(this.#executors, claimed.task_kind)
      ? this.#executors[claimed.task_kind]
      : undefined;
    const heartbeat = maintainLease(
      () =>
        this.#queue.heartbeat(claimed.id, this.owner, claimed.workspace_id, claimed.attempt_count),
      Math.max(1, this.#settings.heartbeatIntervalSeconds) * 1000,
      (error) => logger.exception('analytics_heartbeat_failed', error, { task_id: claimed.id }),
    );
    try {
      if (executor === undefined) {
        throw new ExecutorNotWiredError(
          `analytics task kind '${claimed.task_kind}' has no registered executor`,
        );
      }
      this.#signal?.throwIfAborted();
      const settlement = await executor(claimed, {
        db: this.#db,
        maxAttempts: this.#settings.taskMaxAttempts,
        checkCancelled: async (boundary) => {
          if (heartbeat.signal.aborted || (await this.#queue.isTerminal(claimed.id))) {
            throw new TaskCancelledError(
              `analytics task ${claimed.id} reached a terminal status; stopping at the ${boundary} boundary`,
            );
          }
        },
      });
      // A completed executor owns its evidence settlement, even at the request deadline.
      return settlement ?? null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    } finally {
      await heartbeat.stop();
    }
  }

  /** The one locked terminal write per dispatch. */
  #finalize(claimed: QueueTask, result: Error | TaskSettlement | null): Promise<boolean> {
    const taskId = claimed.id;
    return this.#db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('analytics_tasks')
        .select(['lease_owner', 'status', 'attempt_count', 'max_attempts'])
        .where('id', '=', taskId)
        .where('workspace_id', '=', claimed.workspace_id)
        .where('project_id', claimed.project_id === null ? 'is' : '=', claimed.project_id)
        .where('attempt_count', '=', claimed.attempt_count)
        .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined || row.lease_owner !== this.owner || terminal.includes(row.status)) {
        return false;
      }
      const now = new Date();
      const error = result === null || result instanceof Error ? result : result.error;
      if (result !== null && !(result instanceof Error)) await result.persist(trx);
      const attempt = row.attempt_count + 1;
      const outcome = taskOutcome(
        error,
        attempt,
        row.max_attempts,
        now,
        this.#settings.retryDelaySeconds,
      );
      await trx
        .updateTable('analytics_tasks')
        .set({
          ...outcome,
          attempt_count: attempt,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: now,
        })
        .where('id', '=', taskId)
        .execute();
      return true;
    });
  }
}
