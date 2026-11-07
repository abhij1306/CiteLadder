/**
 * The one Site Health task runner. Every task kind runs under it: the lease
 * heartbeat, a mandatory workspace access check, one lock (crawl, then the
 * queue-fenced task), one settle with one retry backoff, and one handling of a
 * thrown failure. Network-bound kinds (discover, site setup, analyze) acquire
 * outside any transaction and commit through `commitTask`; the rest run inside
 * one transaction the runner opens.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { isActiveCrawl } from '@citeladder/contracts/site-health';
import type { Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { SiteCrawls } from '../generated/db-schema.ts';
import { getLogger } from '../logging.ts';
import { TaskCancelledError } from '../queue/executor.ts';
import { leaseSignal, maintainLease } from '../queue/heartbeat.ts';
import { logLaneFailure } from '../queue/lane-log.ts';
import { SITE_HEALTH_LANE, type SiteTask, type TaskQueue } from '../queue/task-queue.ts';
import type { SitePageFetcher } from './page-fetch.ts';
import type { SiteWorkerSettings } from './runtime.ts';

export type Crawl = Selectable<SiteCrawls>;
export type HeldTask = { crawl: Crawl; task: SiteTask };

export const statuses = policy.task_queue.statuses;
/** Thrown inside a commit to roll back work staged before the lease was re-checked. */
export class Abandoned extends Error {}
/** Thrown by a commit's lock when the crawl stopped; the task is cancelled after the rollback. */
class CrawlStopped extends Abandoned {}
const COUNT_BEARING = new Set<string>(policy.site_health.reads.event_count_bearing_keys);
const logger = getLogger('app.workers.site_health_worker');

/** What every task kind runs with; the runner adds the lease signal. */
export type SiteTaskRunner = {
  db: Database;
  owner: string;
  queue: TaskQueue<'site_crawl_tasks'>;
  fetcher: SitePageFetcher;
  settings: SiteWorkerSettings;
  signal?: AbortSignal;
};
/** The runner adds the lease signal and when the attempt began (`performance.now()`). */
export type SiteTaskContext = SiteTaskRunner & { signal: AbortSignal; startedAt: number };

/** How a kind runs: it acquires and commits itself, or it runs inside the runner's transaction. */
export type SiteTaskWork =
  | { kind: 'acquire'; run: (ctx: SiteTaskContext, task: SiteTask) => Promise<void> }
  | { kind: 'transaction'; run: (trx: Database, crawl: Crawl, task: SiteTask) => Promise<unknown> };

/** How a held task settles. */
export type SiteTaskOutcome =
  | { kind: 'succeeded'; artifactId: string | null }
  | {
      kind: 'failed';
      retryable: boolean;
      errorCode: string;
      errorDetail: string;
      retryAfterSeconds?: number;
      /** The thrown failure, when there was one; logged by class and code only. */
      cause?: unknown;
    }
  /** Lock contention: retried on the conflict budget without spending an attempt. */
  | { kind: 'conflict'; errorDetail: string; cause?: unknown }
  /** Waiting on a prerequisite: requeued without spending an attempt. */
  | { kind: 'deferred'; delaySeconds: number };

/** Uniform jitter in [0, seconds), millisecond resolution. */
const jitter = (seconds: number) => randomInt(Math.max(1, Math.round(seconds * 1000))) / 1000;

/** The delay after failed attempt `attempt` (1-based): exponential from the base, capped, jittered. */
const retryDelay = (settings: SiteWorkerSettings, attempt: number) =>
  Math.min(settings.retryMax, settings.retryBase * 2 ** Math.max(0, attempt - 1)) +
  jitter(settings.retryJitter);

/** Server retry advice: delta seconds or an HTTP date; invalid advice uses normal backoff. */
export function retryAfterSeconds(header: string | undefined, now = Date.now()) {
  if (!header?.trim()) return undefined;
  const raw = header.trim();
  const seconds = /^\d+$/u.test(raw) ? Number(raw) : (Date.parse(raw) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** An update of the task that applies only while this worker still holds its lease. */
export const owned = (db: Database, task: SiteTask, owner: string) =>
  db
    .updateTable('site_crawl_tasks')
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .where('lease_owner', '=', owner);

/** Cancel the task while this worker still holds it; a reclaimed lease belongs to someone else. */
export async function cancelTask(db: Database, task: SiteTask, owner: string) {
  const now = new Date();
  await db
    .updateTable('site_crawl_tasks')
    .set({
      status: statuses.cancelled,
      lease_owner: null,
      lease_expires_at: null,
      completed_at: now,
      updated_at: now,
      error_code: 'cancelled',
    })
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .where('lease_owner', '=', owner)
    .where('status', 'not in', [statuses.succeeded, statuses.failed, statuses.cancelled])
    .execute();
}

export async function loadScope(db: Database, claimed: SiteTask) {
  const task = await db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('id', '=', claimed.id)
    .where('crawl_id', '=', claimed.crawl_id)
    .where('workspace_id', '=', claimed.workspace_id)
    .executeTakeFirst();
  const crawl = await db
    .selectFrom('site_crawls')
    .selectAll()
    .where('id', '=', claimed.crawl_id)
    .where('workspace_id', '=', claimed.workspace_id)
    .executeTakeFirst();
  return task && crawl ? { task, crawl } : null;
}

/** The first task to run moves a queued crawl to running. */
export async function startCrawl(db: Database, crawl: Crawl) {
  if (crawl.status !== 'queued') return;
  const now = new Date();
  await db
    .updateTable('site_crawls')
    .set((eb) => ({
      status: 'running',
      started_at: eb.fn.coalesce('started_at', eb.val(now)),
      updated_at: now,
    }))
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .where('status', '=', 'queued')
    .execute();
}

/**
 * Load the claimed task and start its crawl; null (after cancelling the task
 * when its crawl is no longer active) when it must not run.
 */
export async function prepareTask(ctx: SiteTaskContext, claimed: SiteTask) {
  ctx.signal.throwIfAborted();
  const scope = await loadScope(ctx.db, claimed);
  if (!scope || !isActiveCrawl(scope.crawl.status)) {
    await cancelTask(ctx.db, claimed, ctx.owner);
    return null;
  }
  if (scope.task.lease_owner !== ctx.owner) return null;
  await startCrawl(ctx.db, scope.crawl);
  return scope;
}

export function markRunning(ctx: SiteTaskContext, task: SiteTask) {
  return ctx.queue.markRunning(task.id, ctx.owner);
}

/** Classify a returned HTTP status: a 4xx is terminal except 429; every 5xx is retryable. */
export function httpError(status: number): [string, boolean] | null {
  const codes = policy.site_health.page_analysis.acquisition.error_codes;
  if (status >= 400 && status < 500) return [codes.http_4xx, status === 429];
  return status >= 500 ? [codes.http_5xx, true] : null;
}

/** Whether this failed attempt settles the task as failed rather than retrying it. */
export const finalFailure = (task: SiteTask, retryable: boolean) =>
  !retryable || task.attempt_count + 1 >= task.max_attempts;

/**
 * Site Health's one write lock, in its canonical order: the crawl (of a live
 * project), then the claimed task through the queue's fence (still this
 * owner's, unexpired, at the claimed attempt, not terminal). Null when either
 * no longer holds. `keyShare` lets the heartbeat extend the lease while a long
 * transaction holds the task.
 */
export async function lockSiteTask(
  trx: Database,
  runner: Pick<SiteTaskRunner, 'queue' | 'owner'>,
  claimed: SiteTask,
  strength: 'update' | 'keyShare' = 'update',
): Promise<HeldTask | null> {
  const crawl = await trx
    .selectFrom('site_crawls as crawl')
    .innerJoin('projects as project', (join) =>
      join
        .onRef('project.id', '=', 'crawl.project_id')
        .onRef('project.workspace_id', '=', 'crawl.workspace_id'),
    )
    .selectAll('crawl')
    .where('crawl.id', '=', claimed.crawl_id)
    .where('crawl.workspace_id', '=', claimed.workspace_id)
    .forNoKeyUpdate('crawl')
    .executeTakeFirst();
  const task = await runner.queue.fence(trx, claimed, runner.owner, undefined, strength);
  return crawl && task?.crawl_id === claimed.crawl_id ? { crawl, task } : null;
}

/**
 * One transaction that ends holding the task's lock. `body` takes any locks
 * that precede the crawl in Site Health order, then calls `lock()`, which
 * throws `Abandoned` when the lease was lost. A stopped crawl rolls the body
 * back and cancels the task. Resolves false when nothing committed.
 */
export async function commitTask(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  body: (trx: Database, lock: () => Promise<HeldTask>) => Promise<void>,
): Promise<boolean> {
  ctx.signal.throwIfAborted();
  const committed = await ctx.db
    .transaction()
    .execute(async (trx) => {
      await body(trx, async () => {
        const held = await lockSiteTask(trx, ctx, claimed);
        if (!held) throw new Abandoned();
        if (!isActiveCrawl(held.crawl.status)) throw new CrawlStopped();
        return held;
      });
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof CrawlStopped) return null;
      if (error instanceof Abandoned) return false;
      throw error;
    });
  if (committed === null) await cancelTask(ctx.db, claimed, ctx.owner);
  return committed === true;
}

/** Settle a task this worker holds: success, a retry (backed off or on the conflict budget), a deferral, or a terminal failure. */
export async function settleTask(
  db: Database,
  ctx: Pick<SiteTaskContext, 'owner' | 'settings' | 'startedAt'>,
  task: SiteTask,
  outcome: SiteTaskOutcome,
) {
  const logFailure = (attempt: number, retry: boolean, code: string, cause: unknown) =>
    logLaneFailure(SITE_HEALTH_LANE.table, task, {
      phase: task.task_kind,
      startedAt: ctx.startedAt,
      attempt,
      outcome: retry ? 'retry' : 'failed',
      error: cause,
      code,
    });
  const now = new Date();
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  const released = {
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    updated_at: now,
  };
  const update = owned(db, task, ctx.owner);
  switch (outcome.kind) {
    case 'succeeded':
      await update
        .set({
          ...released,
          status: statuses.succeeded,
          attempt_count: task.attempt_count + 1,
          result_artifact_id: outcome.artifactId,
          completed_at: now,
          error_code: '',
          error_detail: '',
        })
        .execute();
      return;
    case 'deferred':
      await update
        .set({
          ...released,
          status: statuses.queued,
          available_at: at(outcome.delaySeconds),
          error_code: '',
          error_detail: '',
        })
        .execute();
      return;
    case 'conflict': {
      const conflicts = task.conflict_count + 1;
      const retry = conflicts <= ctx.settings.conflictMax;
      await update
        .set({
          ...released,
          status: retry ? statuses.retry_wait : statuses.failed,
          conflict_count: conflicts,
          available_at: at(ctx.settings.conflictBase + jitter(ctx.settings.conflictJitter)),
          completed_at: retry ? null : now,
          error_code: 'db_conflict',
          error_detail: outcome.errorDetail.slice(0, 2000),
        })
        .execute();
      logFailure(task.attempt_count, retry, 'db_conflict', outcome.cause);
      return;
    }
    case 'failed': {
      const attempt = task.attempt_count + 1;
      const retry = !finalFailure(task, outcome.retryable);
      const delay =
        outcome.retryAfterSeconds === undefined
          ? retryDelay(ctx.settings, attempt)
          : Math.min(outcome.retryAfterSeconds, ctx.settings.retryMax);
      await update
        .set({
          ...released,
          status: retry ? statuses.retry_wait : statuses.failed,
          attempt_count: attempt,
          available_at: at(retry ? delay : 0),
          completed_at: retry ? null : now,
          error_code: outcome.errorCode.slice(0, 32),
          error_detail: outcome.errorDetail.slice(0, 2000),
        })
        .execute();
      logFailure(attempt, retry, outcome.errorCode, outcome.cause);
      return;
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unknown Site Health outcome ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Append a crawl event, dropping count-bearing keys unless the crawl discloses counts. */
export async function recordCrawlEvent(
  trx: Database,
  crawl: Crawl,
  eventType: string,
  message: string,
  payload: Record<string, unknown>,
) {
  const disclose = record(crawl.configuration).count_disclosure === true;
  await trx
    .insertInto('site_crawl_events')
    .values({
      id: randomUUID(),
      crawl_id: crawl.id,
      event_type: eventType,
      message,
      payload: JSON.stringify(
        Object.fromEntries(
          Object.entries(payload).filter(([key]) => disclose || !COUNT_BEARING.has(key)),
        ),
      ),
      created_at: new Date(),
    })
    .execute();
}

const failureDetail = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 2000) : 'Site Health task failed';
function isConflict(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && ['40001', '40P01', '55P03'].includes(code);
}

/** A transaction kind: the task held for the body, then settled under the settling lock. */
async function runInTransaction(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  run: Extract<SiteTaskWork, { kind: 'transaction' }>['run'],
) {
  if (!(await markRunning(ctx, claimed))) return;
  await ctx.db.transaction().execute(async (trx) => {
    ctx.signal.throwIfAborted();
    const held = await lockSiteTask(trx, ctx, claimed, 'keyShare');
    if (!held) throw new TaskCancelledError('Site Health task lost its lease or scope');
    await run(trx, held.crawl, held.task);
    ctx.signal.throwIfAborted();
    if (!(await lockSiteTask(trx, ctx, claimed)))
      throw new TaskCancelledError('Site Health task lost its lease or scope');
    await settleTask(trx, ctx, held.task, { kind: 'succeeded', artifactId: null });
  });
}

/**
 * Settle a thrown failure exactly as a returned one: a retryable attempt on the
 * same backoff, or contention on the conflict budget. When a sibling still
 * holds the crawl lock, only the task row is released, so the settle cannot
 * contend again; past the conflict bound recovery settles it at lease expiry.
 */
async function settleThrown(ctx: SiteTaskContext, claimed: SiteTask, error: unknown) {
  const detail = failureDetail(error);
  const outcome: SiteTaskOutcome = isConflict(error)
    ? { kind: 'conflict', errorDetail: detail, cause: error }
    : {
        kind: 'failed',
        retryable: true,
        errorCode: 'task_failed',
        errorDetail: detail,
        cause: error,
      };
  try {
    await ctx.db.transaction().execute(async (trx) => {
      const held = await lockSiteTask(trx, ctx, claimed);
      if (held) await settleTask(trx, ctx, held.task, outcome);
    });
  } catch (error_) {
    if (!isConflict(error_)) throw error_;
    const task = (await loadScope(ctx.db, claimed))?.task;
    if (task?.lease_owner === ctx.owner && task.conflict_count < ctx.settings.conflictMax)
      await settleTask(ctx.db, ctx, task, { kind: 'conflict', errorDetail: detail, cause: error });
  }
}

/**
 * Run one claimed task to settlement under its heartbeat. A throw that is not
 * a lost lease or a cancellation settles through the same settle as a
 * returned failure.
 */
export async function runSiteTask(runner: SiteTaskRunner, claimed: SiteTask, work: SiteTaskWork) {
  const heartbeat = maintainLease(
    () => runner.queue.heartbeat(claimed.id, runner.owner, claimed.workspace_id),
    runner.settings.heartbeat * 1000,
    (error) => logger.exception('heartbeat failed', error, { task_id: claimed.id }),
  );
  const ctx: SiteTaskContext = {
    ...runner,
    signal: leaseSignal(heartbeat.signal, runner.signal),
    startedAt: performance.now(),
  };
  try {
    if (work.kind === 'acquire') await work.run(ctx, claimed);
    else await runInTransaction(ctx, claimed, work.run);
  } catch (error) {
    if (heartbeat.signal.aborted || error instanceof TaskCancelledError) return;
    await settleThrown(ctx, claimed, error);
  } finally {
    await heartbeat.stop();
  }
}
