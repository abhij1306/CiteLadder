/**
 * Plumbing shared by the network-bound Site Health executors (discover, site
 * setup, analyze): the context they run in, lease-owned task updates,
 * cooperative cancellation, crawl start and retry backoff. Each executor
 * acquires outside any transaction and settles its task with its evidence.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import type { SitePageFetcher } from './page-fetch.ts';
import type { Crawl } from './task-fence.ts';

export const statuses = policy.task_queue.statuses;
/** Thrown inside a transaction to roll back work staged before the lease was re-checked. */
export class Abandoned extends Error {}
export const ACTIVE_CRAWL = new Set(['draft', 'validating', 'queued', 'running', 'paused']);
const COUNT_BEARING = new Set<string>(policy.site_health.reads.event_count_bearing_keys);

export function siteTaskSettings(env: Record<string, string | undefined> = process.env) {
  const spec = policy.site_health.settings;
  const number = (name: keyof typeof spec) => Number(resolveSettingSpec(spec[name], env));
  return {
    dependencyRetry: number('analysis_dependency_retry_seconds'),
    dependencyRetryMax: number('analysis_dependency_retry_max_seconds'),
    dependencyMaxWait: number('analysis_dependency_max_wait_seconds'),
    retryBase: number('retry_base_delay_seconds'),
    retryMax: number('retry_max_delay_seconds'),
    retryJitter: number('retry_jitter_seconds'),
  };
}
export type SiteTaskSettings = ReturnType<typeof siteTaskSettings>;
export type SiteTaskContext = {
  db: Database;
  owner: string;
  fetcher: SitePageFetcher;
  settings: SiteTaskSettings;
  signal?: AbortSignal;
};

/** Exponential retry backoff with deterministic jitter (the attempt number, not a random draw). */
const retryDelay = (settings: SiteTaskSettings, attempt: number) =>
  Math.min(settings.retryBase * 2 ** attempt, settings.retryMax) +
  ((attempt * 0.37) % 1) * settings.retryJitter;

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

/** The first task to run moves a queued (or resumed) crawl to running. */
export async function startCrawl(db: Database, crawl: Crawl) {
  if (crawl.status === 'running' || !['queued', 'paused'].includes(crawl.status)) return;
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
    .where('status', 'in', ['queued', 'paused'])
    .execute();
}

/**
 * Load the claimed task and start its crawl; null (after cancelling the task
 * when its crawl is no longer active) when it must not run.
 */
export async function prepareTask(ctx: SiteTaskContext, claimed: SiteTask) {
  ctx.signal?.throwIfAborted();
  const scope = await loadScope(ctx.db, claimed);
  if (!scope || !ACTIVE_CRAWL.has(scope.crawl.status)) {
    await cancelTask(ctx.db, claimed, ctx.owner);
    return null;
  }
  if (scope.task.lease_owner !== ctx.owner) return null;
  await startCrawl(ctx.db, scope.crawl);
  return scope;
}

export async function markRunning(db: Database, task: SiteTask, owner: string) {
  const result = await owned(db, task, owner)
    .set({ status: statuses.running, heartbeat_at: new Date(), updated_at: new Date() })
    .where('status', '=', statuses.leased)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
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

/** Settle the leased task: success with its artifact, a backed-off retry, or a terminal failure. */
export async function settleTask(
  trx: Database,
  ctx: SiteTaskContext,
  task: SiteTask,
  outcome:
    | { succeeded: true; artifactId: string | null }
    | {
        succeeded: false;
        retryable: boolean;
        errorCode: string;
        errorDetail: string;
        retryAfterSeconds?: number;
      },
) {
  const now = new Date();
  const attempt = task.attempt_count + 1;
  const released = {
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    updated_at: now,
  };
  if (outcome.succeeded) {
    await owned(trx, task, ctx.owner)
      .set({
        ...released,
        status: statuses.succeeded,
        attempt_count: attempt,
        result_artifact_id: outcome.artifactId,
        completed_at: now,
        error_code: '',
        error_detail: '',
      })
      .execute();
    return;
  }
  const retry = !finalFailure(task, outcome.retryable);
  const delay =
    outcome.retryAfterSeconds === undefined
      ? retryDelay(ctx.settings, attempt)
      : Math.min(outcome.retryAfterSeconds, ctx.settings.retryMax);
  await owned(trx, task, ctx.owner)
    .set({
      ...released,
      status: retry ? statuses.retry_wait : statuses.failed,
      attempt_count: attempt,
      available_at: new Date(now.getTime() + (retry ? delay * 1000 : 0)),
      completed_at: retry ? null : now,
      error_code: outcome.errorCode.slice(0, 32),
      error_detail: outcome.errorDetail.slice(0, 2000),
    })
    .execute();
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

/**
 * Lock crawl then task in Site Health order and confirm this worker still
 * runs the task on an active crawl; null when either no longer holds.
 */
export async function lockRunningTask(trx: Database, claimed: SiteTask, owner: string) {
  const crawl = await trx
    .selectFrom('site_crawls')
    .selectAll()
    .where('id', '=', claimed.crawl_id)
    .where('workspace_id', '=', claimed.workspace_id)
    .forNoKeyUpdate()
    .executeTakeFirst();
  const task = await trx
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('id', '=', claimed.id)
    .where('workspace_id', '=', claimed.workspace_id)
    .where('lease_owner', '=', owner)
    .where('status', '=', statuses.running)
    // An expired lease is the sweeper's to reclaim; late writes stay fenced.
    .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
    .forUpdate()
    .executeTakeFirst();
  if (!crawl || !task) return null;
  return { crawl, task };
}
