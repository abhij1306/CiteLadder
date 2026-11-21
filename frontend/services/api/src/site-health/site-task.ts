import { randomInt } from 'node:crypto';
import { isActiveCrawl } from '@citeladder/contracts/site-health';
import type { Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { timeOrderedId } from '../db/ids.ts';
import { isRetryableContention } from '../db/errors.ts';
import { record } from '../db/json.ts';
import type { SiteCrawls } from '../generated/db-schema.ts';
import { getLogger } from '../logging.ts';
import { TaskCancelledError } from '../queue/executor.ts';
import { leaseSignal, maintainLease } from '../queue/heartbeat.ts';
import { logLaneFailure } from '../queue/lane-log.ts';
import {
  asyncCommit,
  SITE_HEALTH_LANE,
  type SiteTask,
  type TaskQueue,
} from '../queue/task-queue.ts';
import type { SitePageFetcher } from './page-fetch.ts';
import type { SiteWorkerSettings } from './runtime.ts';

/**
 * Every crawl column but the score summary: it grows with the crawl (tens of
 * kilobytes, read back from TOAST) and only the crawl projection reads it, so
 * the task, lock and reconcile paths never load it.
 */
export const CRAWL_COLUMNS = [
  'admitted_url_count',
  'analysis_requested_count',
  'analysis_status',
  'analyzed_url_count',
  'analyzer_version',
  'completed_at',
  'configuration',
  'created_at',
  'discovered_url_count',
  'discovery_requested_count',
  'discovery_status',
  'error_message',
  'extractor_version',
  'failed_url_count',
  'id',
  'inventory_complete',
  'live_counters',
  'partial_reason',
  'profile_id',
  'project_id',
  'random_seed',
  'robots_observed_at',
  'robots_snapshot_id',
  'root_url',
  'rule_catalog_version',
  'sample_mode',
  'scoring_version',
  'site_facts',
  'started_at',
  'status',
  'terminal_counters',
  'updated_at',
  'workspace_id',
] as const satisfies readonly Exclude<keyof SiteCrawls, 'score_summary'>[];
export type Crawl = Pick<Selectable<SiteCrawls>, (typeof CRAWL_COLUMNS)[number]>;
export type ProjectedCrawl = Selectable<SiteCrawls>;
export type HeldTask = { crawl: Crawl; task: SiteTask };

export const statuses = policy.task_queue.statuses;
export class Abandoned extends Error {}
class CrawlStopped extends Abandoned {}
const COUNT_BEARING = new Set<string>(policy.site_health.reads.event_count_bearing_keys);
const logger = getLogger('app.workers.site_health_worker');

export type SiteTaskRunner = {
  db: Database;
  owner: string;
  queue: TaskQueue<'site_crawl_tasks'>;
  fetcher: SitePageFetcher;
  settings: SiteWorkerSettings;
  signal?: AbortSignal;
};
export type SiteTaskContext = SiteTaskRunner & { signal: AbortSignal; startedAt: number };

export type SiteTaskWork =
  | { kind: 'acquire'; run: (ctx: SiteTaskContext, task: SiteTask) => Promise<void> }
  | { kind: 'transaction'; run: (trx: Database, crawl: Crawl, task: SiteTask) => Promise<unknown> };

export type SiteTaskOutcome =
  | { kind: 'succeeded'; artifactId: string | null }
  | {
      kind: 'failed';
      retryable: boolean;
      errorCode: string;
      errorDetail: string;
      retryAfterSeconds?: number;
      cause?: unknown;
    }
  | { kind: 'conflict'; errorDetail: string; cause?: unknown }
  | { kind: 'deferred'; delaySeconds: number };

const jitter = (seconds: number) => randomInt(Math.max(1, Math.round(seconds * 1000))) / 1000;

const retryDelay = (settings: SiteWorkerSettings, attempt: number) =>
  Math.min(settings.retryMax, settings.retryBase * 2 ** Math.max(0, attempt - 1)) +
  jitter(settings.retryJitter);

export const owned = (db: Database, task: SiteTask, owner: string) =>
  db
    .updateTable('site_crawl_tasks')
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .where('lease_owner', '=', owner)
    .where('attempt_count', '=', task.attempt_count);

/**
 * Whether the loaded row is still this slot's claim. A worker's owner is fixed
 * for its lifetime, so the attempt tells a stale slot from the same worker's
 * re-claim after recovery charged the expired lease. The commit fence decides.
 */
export const heldBySlot = (loaded: SiteTask, claimed: SiteTask, owner: string) =>
  loaded.lease_owner === owner && loaded.attempt_count === claimed.attempt_count;

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
    .select(CRAWL_COLUMNS)
    .where('id', '=', claimed.crawl_id)
    .where('workspace_id', '=', claimed.workspace_id)
    .executeTakeFirst();
  return task && crawl ? { task, crawl } : null;
}

export type TaskScope = NonNullable<Awaited<ReturnType<typeof loadScope>>>;

export async function startCrawl(
  ctx: Pick<SiteTaskContext, 'db' | 'owner'>,
  { crawl, task }: TaskScope,
): Promise<TaskScope | null> {
  let current: Crawl | undefined = crawl;
  if (crawl.status === 'queued') {
    const now = new Date();
    current =
      (await ctx.db
        .updateTable('site_crawls')
        .set((eb) => ({
          status: 'running',
          started_at: eb.fn.coalesce('started_at', eb.val(now)),
          updated_at: now,
        }))
        .where('id', '=', crawl.id)
        .where('workspace_id', '=', crawl.workspace_id)
        .where('status', '=', 'queued')
        .returning(CRAWL_COLUMNS)
        .executeTakeFirst()) ??
      (await ctx.db
        .selectFrom('site_crawls')
        .select(CRAWL_COLUMNS)
        .where('id', '=', crawl.id)
        .where('workspace_id', '=', crawl.workspace_id)
        .executeTakeFirst());
  }
  if (current && isActiveCrawl(current.status)) return { task, crawl: current };
  await cancelTask(ctx.db, task, ctx.owner);
  return null;
}

export async function prepareTask(ctx: SiteTaskContext, claimed: SiteTask) {
  ctx.signal.throwIfAborted();
  const scope = await loadScope(ctx.db, claimed);
  if (!scope || !isActiveCrawl(scope.crawl.status)) {
    await cancelTask(ctx.db, claimed, ctx.owner);
    return null;
  }
  if (!heldBySlot(scope.task, claimed, ctx.owner)) return null;
  return startCrawl(ctx, scope);
}

export function httpError(status: number): [string, boolean] | null {
  const codes = policy.site_health.page_analysis.acquisition.error_codes;
  if (status >= 400 && status < 500) return [codes.http_4xx, status === 429];
  return status >= 500 ? [codes.http_5xx, true] : null;
}

export const finalFailure = (task: SiteTask, retryable: boolean) =>
  !retryable || task.attempt_count + 1 >= task.max_attempts;

export type CrawlLock = 'update' | 'share';

export async function lockSiteTask(
  trx: Database,
  runner: Pick<SiteTaskRunner, 'queue' | 'owner'>,
  claimed: SiteTask,
  strength: { task?: 'update' | 'keyShare'; crawl?: CrawlLock } = {},
): Promise<HeldTask | null> {
  const query = trx
    .selectFrom('site_crawls as crawl')
    .innerJoin('projects as project', (join) =>
      join
        .onRef('project.id', '=', 'crawl.project_id')
        .onRef('project.workspace_id', '=', 'crawl.workspace_id'),
    )
    .select(CRAWL_COLUMNS.map((column) => `crawl.${column}` as const))
    .where('crawl.id', '=', claimed.crawl_id)
    .where('crawl.workspace_id', '=', claimed.workspace_id);
  const crawl = await (
    strength.crawl === 'share' ? query.forShare('crawl') : query.forNoKeyUpdate('crawl')
  ).executeTakeFirst();
  const task = await runner.queue.fence(trx, claimed, runner.owner, undefined, strength.task);
  return crawl && task?.crawl_id === claimed.crawl_id ? { crawl, task } : null;
}

export async function commitTask(
  ctx: Pick<SiteTaskContext, 'db' | 'owner' | 'queue' | 'signal'>,
  claimed: SiteTask,
  body: (trx: Database, lock: (crawl?: CrawlLock) => Promise<HeldTask>) => Promise<void>,
): Promise<boolean> {
  ctx.signal.throwIfAborted();
  const committed = await asyncCommit(ctx.db, async (trx) => {
    await body(trx, async (crawl) => {
      const held = await lockSiteTask(trx, ctx, claimed, { crawl });
      if (!held) throw new Abandoned();
      if (!isActiveCrawl(held.crawl.status)) throw new CrawlStopped();
      return held;
    });
    return true;
  }).catch((error: unknown) => {
    if (error instanceof CrawlStopped) return null;
    if (error instanceof Abandoned) return false;
    throw error;
  });
  if (committed === null) await cancelTask(ctx.db, claimed, ctx.owner);
  return committed === true;
}

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
      id: timeOrderedId(),
      workspace_id: crawl.workspace_id,
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

async function runInTransaction(
  ctx: SiteTaskContext,
  claimed: SiteTask,
  run: Extract<SiteTaskWork, { kind: 'transaction' }>['run'],
) {
  await asyncCommit(ctx.db, async (trx) => {
    ctx.signal.throwIfAborted();
    const held = await lockSiteTask(trx, ctx, claimed, { task: 'keyShare' });
    if (!held) throw new TaskCancelledError('Site Health task lost its lease or scope');
    await run(trx, held.crawl, held.task);
    ctx.signal.throwIfAborted();
    if (!(await lockSiteTask(trx, ctx, claimed)))
      throw new TaskCancelledError('Site Health task lost its lease or scope');
    await settleTask(trx, ctx, held.task, { kind: 'succeeded', artifactId: null });
  });
}

async function settleThrown(ctx: SiteTaskContext, claimed: SiteTask, error: unknown) {
  const detail = failureDetail(error);
  const outcome: SiteTaskOutcome = isRetryableContention(error)
    ? { kind: 'conflict', errorDetail: detail, cause: error }
    : {
        kind: 'failed',
        retryable: true,
        errorCode: 'task_failed',
        errorDetail: detail,
        cause: error,
      };
  try {
    await asyncCommit(ctx.db, async (trx) => {
      const held = await lockSiteTask(trx, ctx, claimed);
      if (held) await settleTask(trx, ctx, held.task, outcome);
    });
  } catch (error_) {
    if (!isRetryableContention(error_)) throw error_;
    // The task row alone, through the lease fence: a re-claimed lease is never settled here.
    await asyncCommit(ctx.db, async (trx) => {
      const task = await ctx.queue.fence(trx, claimed, ctx.owner);
      if (task && task.conflict_count < ctx.settings.conflictMax)
        await settleTask(trx, ctx, task, { kind: 'conflict', errorDetail: detail, cause: error });
    }).catch((contended: unknown) => {
      // A cancel or sibling still holds the task row: lease recovery settles it at
      // expiry. Throwing would fail the whole runner lane for one task's lock wait.
      if (!isRetryableContention(contended)) throw contended;
      logger.warning('site_task_settle_contended', { task_id: claimed.id });
    });
  }
}

export async function runSiteTask(runner: SiteTaskRunner, claimed: SiteTask, work: SiteTaskWork) {
  const heartbeat = maintainLease(
    // At the claimed attempt: recovery charges one, so a re-claim never renews this slot.
    () =>
      runner.queue.heartbeat(claimed.id, runner.owner, claimed.workspace_id, claimed.attempt_count),
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
