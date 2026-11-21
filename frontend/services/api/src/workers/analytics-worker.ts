import { randomBytes } from 'node:crypto';

import { ConfigError } from '../config/config-error.ts';
import { policy } from '../config.ts';
import type { WorkerSettings } from '../config/analytics.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { recoverAnalyticsLeases } from '../queue/analytics-recovery.ts';
import {
  TaskCancelledError,
  TerminalExecutorError,
  type Executor,
  type TaskSettlement,
} from '../queue/executor.ts';
import { maintainLease } from '../queue/heartbeat.ts';
import { logLaneFailure } from '../queue/lane-log.ts';
import { ANALYTICS_LANE, TaskQueue, type ClaimScope, type QueueTask } from '../queue/task-queue.ts';
import {
  ANALYTICS_KIND_NAMES,
  ANALYTICS_KINDS,
  ANALYTICS_LEASE_TTL_SECONDS,
} from './analytics-kinds.ts';
import { compensateTerminalTasks } from './terminal-compensation.ts';

const logger = getLogger('workers.analytics');
const { statuses } = policy.task_queue;
const ERROR_DETAIL_LIMIT = 2000;

export const EXECUTORS: Readonly<Record<string, Executor>> = Object.fromEntries(
  Object.entries(ANALYTICS_KINDS).map(([kind, { run }]) => [kind, run]),
);

class ExecutorNotWiredError extends Error {}

const detail = (error: Error) => [...String(error.message)].slice(0, ERROR_DETAIL_LIMIT).join('');

export function retryDelayMs(
  attempt: number,
  settings: Pick<WorkerSettings, 'retryDelaySeconds' | 'retryMaxDelaySeconds'>,
  random: () => number = Math.random,
): number {
  const exponential = settings.retryDelaySeconds * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(settings.retryMaxDelaySeconds, exponential);
  return Math.round(capped * 1000 * (0.5 + random() / 2));
}

function taskOutcome(
  error: Error | null,
  attempt: number,
  maxAttempts: number,
  now: Date,
  settings: WorkerSettings,
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
      available_at: new Date(now.getTime() + retryDelayMs(attempt, settings)),
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
    if (
      Object.values(ANALYTICS_LEASE_TTL_SECONDS).some(
        (lease) => settings.heartbeatIntervalSeconds >= lease,
      )
    ) {
      throw new ConfigError('heartbeat_interval_seconds must be shorter than every lease TTL');
    }
    this.#db = db;
    this.#settings = settings;
    this.#queue = new TaskQueue(db, ANALYTICS_LANE, {
      leaseTtlSeconds: settings.leaseTtlSeconds,
      leaseTtlSecondsByKind: ANALYTICS_LEASE_TTL_SECONDS,
    });
    this.#executors = options.executors ?? EXECUTORS;
    this.#scope = options.taskScope;
    this.#signal = options.signal;
    this.owner = options.owner ?? `analytics-worker-ts-${randomBytes(6).toString('hex')}`;
  }

  async runOnce(): Promise<number> {
    if (this.#signal?.aborted) return 0;
    await recoverAnalyticsLeases(this.#db, this.#settings.leaseReclaimBatchSize, this.#scope);
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

  nextDue(): Promise<Date | null> {
    return this.#queue.nextDue(this.#kinds());
  }

  #kinds(): readonly string[] {
    return this.#scope ? Object.keys(this.#executors) : ANALYTICS_KIND_NAMES;
  }

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
    const startedAt = performance.now();
    let started = false;
    try {
      if (await this.#queue.isTerminal(claimed.id, claimed.workspace_id)) return;
      if (!(await this.#queue.markRunning(claimed.id, this.owner, claimed.attempt_count))) return;
      started = true;
      await this.#finalize(claimed, await this.#run(claimed), startedAt);
    } catch (error) {
      logger.exception('analytics_task_crashed', error, { task_id: claimed.id });
      if (started)
        await this.#finalize(claimed, error as Error, startedAt).catch((settleError: unknown) =>
          logger.exception('analytics_task_settle_failed', settleError, { task_id: claimed.id }),
        );
    }
  }

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
          if (
            heartbeat.signal.aborted ||
            (await this.#queue.isTerminal(claimed.id, claimed.workspace_id))
          ) {
            throw new TaskCancelledError(
              `analytics task ${claimed.id} reached a terminal status; stopping at the ${boundary} boundary`,
            );
          }
        },
      });
      return settlement ?? null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    } finally {
      await heartbeat.stop();
    }
  }

  async #finalize(
    claimed: QueueTask,
    result: Error | TaskSettlement | null,
    startedAt: number,
  ): Promise<boolean> {
    const taskId = claimed.id;
    const settled = await this.#db.transaction().execute(async (trx) => {
      const row = await this.#queue.fence(trx, claimed, this.owner);
      if (row === undefined) return null;
      const now = new Date();
      const error = result === null || result instanceof Error ? result : result.error;
      if (result !== null && !(result instanceof Error)) await result.persist(trx);
      const attempt = row.attempt_count + 1;
      const outcome = taskOutcome(error, attempt, row.max_attempts, now, this.#settings);
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
      return { error, attempt, outcome };
    });
    if (settled === null) return false;
    if (settled.error !== null)
      logLaneFailure(ANALYTICS_LANE.table, claimed, {
        phase: claimed.task_kind,
        startedAt,
        attempt: settled.attempt,
        outcome: settled.outcome.status === statuses.failed ? 'failed' : 'retry',
        error: settled.error,
        code: settled.outcome.error_code,
      });
    return true;
  }
}
