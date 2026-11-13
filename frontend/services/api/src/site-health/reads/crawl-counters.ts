/**
 * The crawl's counters: the one chooser every crawl read uses, and the live
 * scan of its tasks and analyses. Nothing here writes.
 */
import { crawlCountersSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../../db/database.ts';
import { firstOf } from '../../lists.ts';
import { failedAs } from '../task-outcome.ts';
import { countDisclosure, isTerminal, type Crawl } from './crawl.ts';

type Counters = z.input<typeof crawlCountersSchema>;

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * The task a page's status reads (alias `t`): its analysis, else a fetch that
 * failed for good, so a URL that could never be fetched counts and lists as
 * an error. A URL the crawl's own policy excluded is not one.
 */
export const ROW_TASK = sql`(t.task_kind = 'analyze'
  or (t.task_kind = 'discover' and t.status = 'failed'
    and not ${failedAs('t', ['excluded'])}))`;
/** Which `ROW_TASK` row wins: the analysis, then the latest generation. */
export const ROW_TASK_ORDER = sql`t.task_kind = 'analyze' desc, t.generation desc`;

/** What the crawl's tasks and analyses count: every counter except the live selection. */
export type TaskCounters = Omit<Counters, 'selected'>;
const terminalCountersSchema = crawlCountersSchema.omit({ selected: true });

/** The project's active monitored selection: current configuration, read live. */
async function selectedCount(db: Database, crawl: Crawl) {
  const row = await db
    .selectFrom('monitored_site_urls')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('active', '=', true)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * The one counter chooser every crawl read uses, with the live selection. An
 * active crawl counts its tasks live; a terminal one reads the counters its
 * terminalization persisted (`site-health/terminal-counters.ts`). A terminal
 * crawl without persisted counters is counted from its tasks rather than
 * reported as zeros it never observed.
 */
export async function crawlCounters(db: Database, crawl: Crawl): Promise<Counters> {
  const persisted =
    isTerminal(crawl) && crawl.terminal_counters !== null
      ? terminalCountersSchema.parse(crawl.terminal_counters)
      : null;
  const [counters, selected] = await Promise.all([
    persisted ?? taskCounters(db, crawl),
    selectedCount(db, crawl),
  ]);
  return { ...counters, selected };
}

/** Counters of the crawl's own tasks and analyses, scanned now. */
export async function taskCounters(db: Database, crawl: Crawl): Promise<TaskCounters> {
  // A site or policy refusal is no page error: it counts as blocked.
  const refused = failedAs('t', ['blocked', 'excluded']);
  const tasks = sql<{
    queued: number;
    running: number;
    analyzed: number;
    failed: number;
    blocked: number;
    robots_denied: number;
    http_4xx: number;
    http_5xx: number;
    timeout: number;
    ready: number;
    waiting: number;
    leased_live: number;
    running_live: number;
    expired: number;
    next_available_at: Date | null;
  }>`
    with latest as (
      select distinct on (t.site_url_id) t.status, t.error_code, t.available_at, t.lease_expires_at
      from site_crawl_tasks t
      where t.workspace_id = ${crawl.workspace_id} and t.crawl_id = ${crawl.id}
        and ${ROW_TASK} and t.site_url_id is not null
      order by t.site_url_id, ${ROW_TASK_ORDER}
    )
    select
      count(*) filter (where status in ('queued','retry_wait','capacity_wait'))::int as queued,
      count(*) filter (where status in ('leased','running'))::int as running,
      count(*) filter (where status = 'succeeded')::int as analyzed,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status = 'failed' and ${refused})::int as blocked,
      count(*) filter (where status = 'failed' and error_code = 'robots_denied')::int as robots_denied,
      count(*) filter (where status = 'failed' and error_code = 'http_4xx')::int as http_4xx,
      count(*) filter (where status = 'failed' and error_code = 'http_5xx')::int as http_5xx,
      count(*) filter (where status = 'failed' and error_code = 'timeout')::int as timeout,
      count(*) filter (where status in ('queued','retry_wait','capacity_wait') and available_at <= now())::int as ready,
      count(*) filter (where status in ('queued','retry_wait','capacity_wait') and available_at > now())::int as waiting,
      count(*) filter (where status = 'leased' and lease_expires_at > now())::int as leased_live,
      count(*) filter (where status = 'running' and lease_expires_at > now())::int as running_live,
      count(*) filter (where status in ('leased','running') and lease_expires_at <= now())::int as expired,
      min(available_at) filter (where status in ('queued','retry_wait','capacity_wait') and available_at > now()) as next_available_at
    from latest t`.execute(db);
  const [counts, kinds, excluded] = await Promise.all([
    tasks,
    sql<{ page_kind: string; count: number }>`
      select page_kind, count(*)::int as count from (
        select distinct on (site_url_id) coalesce(page_kind, 'other') as page_kind
        from site_page_analyses
        where workspace_id = ${crawl.workspace_id} and crawl_id = ${crawl.id} and status = 'completed'
        order by site_url_id, created_at desc
      ) latest group by page_kind`.execute(db),
    // URLs admitted and then declined by the crawl's own policy leave both
    // sides of analyzed/total, in whichever task kind declined them.
    sql<{ count: number }>`
      select count(distinct url_hash)::int as count from site_crawl_tasks
      where workspace_id = ${crawl.workspace_id} and crawl_id = ${crawl.id}
        and task_kind in ('discover','analyze') and status = 'failed'
        and ${failedAs('site_crawl_tasks', ['excluded'])} and url_hash <> ''`.execute(db),
  ]);
  const c = firstOf(counts.rows, 'the crawl task counters');
  const terminal = isTerminal(crawl);
  let state: Counters['activity']['state'] = 'working';
  let reason: Counters['activity']['reason'] = 'active_work';
  if (terminal) [state, reason] = ['terminal', 'terminal'];
  else if (c.expired) [state, reason] = ['stalled', 'expired_lease'];
  else if (c.waiting && !(c.ready || c.leased_live || c.running_live))
    [state, reason] = ['waiting', 'retry_backoff'];
  return {
    discovered: countDisclosure(crawl)
      ? Math.max(
          crawl.admitted_url_count - firstOf(excluded.rows, 'the excluded URL count').count,
          0,
        )
      : null,
    queued: c.queued,
    running: c.running,
    analyzed: c.analyzed,
    errors: Math.max(c.failed - c.blocked, 0),
    blocked: c.blocked,
    failure_breakdown: {
      robots_denied: c.robots_denied,
      http_4xx: c.http_4xx,
      http_5xx: c.http_5xx,
      timeout: c.timeout,
    },
    activity: {
      state,
      reason,
      queue_depth: c.ready + c.waiting + c.leased_live + c.running_live + c.expired,
      next_available_at: iso(c.next_available_at),
    },
    by_page_kind: Object.fromEntries(kinds.rows.map((row) => [row.page_kind, row.count])),
  };
}
