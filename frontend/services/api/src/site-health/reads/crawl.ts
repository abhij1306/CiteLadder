/**
 * Workspace-scoped crawl loading and the crawl projection every Site Health
 * read shares. A foreign or missing crawl is a 404; nothing here writes.
 */
import type { crawlCountersSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import type { z } from 'zod';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record, strings } from '../../db/json.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import { notFound } from '../../errors.ts';
import { parseUuid } from '../../http/uuid.ts';
import { firstOf } from '../../lists.ts';
import type { Crawl } from '../task-fence.ts';

const reads = policy.site_health.reads;
const TERMINAL = new Set<string>(reads.terminal_crawl_statuses);
const USABLE = ['completed', 'partially_completed', 'cancelled'] as const;
const NOT_MEASURED = 'not_measured';

export type { Crawl };
type Counters = z.input<typeof crawlCountersSchema>;
type ScoreSummary = ReturnType<typeof scoreSummary>;
export type FailureSummary = {
  code: string;
  message: string;
  attempts: number | null;
  status_code: number | null;
  target_url: string;
};

export const isTerminal = (crawl: Crawl) => TERMINAL.has(crawl.status);

/** The crawl in the workspace, or 404. */
export async function loadCrawl(db: Database, workspaceId: string, crawlId: string) {
  const crawl = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_crawls')
    .selectAll()
    .where('id', '=', crawlId)
    .executeTakeFirst();
  if (crawl === undefined) throw notFound('Crawl');
  return crawl;
}

export async function loadProject(db: Database, workspaceId: string, projectId: string) {
  const project = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
}

/**
 * The named crawl (404 when foreign) or the project's newest usable one. A
 * named crawl that has not reached a usable terminal state, or a project with
 * none, is `null`: the caller renders its own "nothing yet" state.
 */
export async function resolveUsableCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
): Promise<Crawl | null> {
  await loadProject(db, workspaceId, projectId);
  const crawls = new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_crawls')
    .selectAll()
    .where('project_id', '=', projectId);
  if (crawlId !== null) {
    const crawl = await crawls.where('id', '=', crawlId).executeTakeFirst();
    if (crawl === undefined) throw notFound('Crawl');
    return (USABLE as readonly string[]).includes(crawl.status) ? crawl : null;
  }
  const latest = await crawls
    .where('status', 'in', USABLE)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return latest ?? null;
}

/** Only a crawl frozen with count disclosure may reveal discovered totals. */
export const countDisclosure = (crawl: Crawl) =>
  record(crawl.configuration).count_disclosure === true;

/** Earlier full crawls whose inventory a Starter recrawl reads; none for a sample crawl. */
function inheritedCrawlIds(crawl: Crawl): string[] {
  if (crawl.sample_mode) return [];
  const ids = strings(record(crawl.configuration)[reads.inventory_source_crawl_ids_key]).map(
    (value) => parseUuid(value),
  );
  return [...new Set(ids.filter((id): id is string => id !== null && id !== crawl.id))];
}

/** The crawl followed by its frozen inventory lineage. */
export const inventoryCrawlIds = (crawl: Crawl) => [crawl.id, ...inheritedCrawlIds(crawl)];

const int = (value: unknown) => (typeof value === 'number' ? Math.trunc(value) : 0);
const num = (value: unknown) => (typeof value === 'number' ? value : null);
const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value !== '' ? value : fallback;

/** The worker-written `score_summary`, or null before scoring. */
export function scoreSummary(crawl: Crawl) {
  const summary = record(crawl.score_summary);
  if (Object.keys(summary).length === 0) return null;
  const byKind = Object.entries(record(summary.by_page_kind)).map(([kind, raw]) => {
    const values = record(raw);
    return [
      kind,
      {
        analyzed_count: int(values.analyzed_count),
        web_fundamentals_score: num(values.web_fundamentals_score),
        web_fundamentals_coverage: num(values.web_fundamentals_coverage),
        web_fundamentals_state: text(values.web_fundamentals_state, NOT_MEASURED),
        aeo_readiness_score: num(values.aeo_readiness_score),
        aeo_measurement_coverage: num(values.aeo_measurement_coverage),
        aeo_measurement_state: text(values.aeo_measurement_state, NOT_MEASURED),
        aeo_measurement_reason: text(values.aeo_measurement_reason, ''),
      },
    ] as const;
  });
  return {
    web_fundamentals_score: num(summary.web_fundamentals_score),
    web_fundamentals_coverage: num(summary.web_fundamentals_coverage),
    web_fundamentals_state: text(summary.web_fundamentals_state, NOT_MEASURED),
    aeo_readiness_score: num(summary.aeo_readiness_score),
    aeo_measurement_coverage: num(summary.aeo_measurement_coverage),
    aeo_measurement_state: text(summary.aeo_measurement_state, NOT_MEASURED),
    search_eligibility: text(summary.search_eligibility, 'unknown'),
    selected_count: int(summary.selected_count),
    analyzed_count: int(summary.analyzed_count),
    issue_count: int(summary.issue_count),
    scoring_version: text(summary.scoring_version, crawl.scoring_version || reads.scoring_version),
    classified_page_count: int(summary.classified_page_count),
    other_page_count: int(summary.other_page_count),
    classification_error_page_count: int(summary.classification_error_page_count),
    classification_expected_page_count: int(summary.classification_expected_page_count),
    classification_coverage: num(summary.classification_coverage),
    classification_state: text(summary.classification_state, NOT_MEASURED),
    classification_reason_groups: record(summary.classification_reason_groups),
    classification_formula_version: text(summary.classification_formula_version, ''),
    classification_source_analysis_ids: strings(summary.classification_source_analysis_ids),
    classification_source_artifact_ids: strings(summary.classification_source_artifact_ids),
    classification_source_task_ids: strings(summary.classification_source_task_ids),
    scored_page_kind_set: strings(summary.scored_page_kind_set),
    scored_page_count_by_kind: record(summary.scored_page_count_by_kind),
    by_page_kind: Object.fromEntries(byKind),
  };
}

/** Counters derived from the crawl row alone (list and detail reads). */
function rowCounters(crawl: Crawl, summary: ScoreSummary): Counters {
  const terminal = crawl.completed_at !== null;
  return {
    discovered: countDisclosure(crawl) ? crawl.admitted_url_count : null,
    selected: summary?.selected_count ?? 0,
    queued: Math.max(
      crawl.analysis_requested_count - crawl.analyzed_url_count - crawl.failed_url_count,
      0,
    ),
    running: 0,
    analyzed: crawl.analyzed_url_count,
    errors: crawl.failed_url_count,
    blocked: 0,
    failure_breakdown: { robots_denied: 0, http_4xx: 0, http_5xx: 0, timeout: 0 },
    activity: {
      state: terminal ? 'terminal' : 'working',
      reason: terminal ? 'terminal' : 'active_work',
      queue_depth: 0,
      next_available_at: null,
    },
    by_page_kind: Object.fromEntries(
      Object.entries(summary?.by_page_kind ?? {}).map(([kind, bucket]) => [
        kind,
        bucket.analyzed_count,
      ]),
    ),
  };
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * The crawl contract, with discovered totals redacted unless the crawl was
 * frozen with count disclosure. The inventory total is the larger of fetched
 * and admitted URLs: a sitemap crawl fetches the root once and admits many.
 */
export function projectCrawl(
  crawl: Crawl,
  options: { failureSummary?: FailureSummary | null; counters?: Counters } = {},
) {
  const disclose = countDisclosure(crawl);
  const summary = scoreSummary(crawl);
  const inventoryTotal = Math.max(crawl.discovered_url_count, crawl.admitted_url_count);
  return {
    id: crawl.id,
    workspace_id: crawl.workspace_id,
    project_id: crawl.project_id,
    profile_id: crawl.profile_id,
    status: crawl.status,
    discovery_status: crawl.discovery_status,
    analysis_status: crawl.analysis_status,
    root_url: crawl.root_url,
    sample_mode: crawl.sample_mode,
    seed: crawl.random_seed,
    inventory_complete: crawl.inventory_complete,
    partial_reason: crawl.partial_reason,
    visible_url_count: crawl.admitted_url_count,
    analyzed_count: crawl.analyzed_url_count,
    failed_count: crawl.failed_url_count,
    discovery_requested_count: crawl.discovery_requested_count,
    analysis_requested_count: crawl.analysis_requested_count,
    counters: options.counters ?? rowCounters(crawl, summary),
    discovered_count: disclose ? inventoryTotal : null,
    total_url_count: disclose && crawl.inventory_complete ? inventoryTotal : null,
    has_more_site_urls: disclose ? !crawl.inventory_complete : null,
    score_summary: summary,
    failure_summary: options.failureSummary ?? null,
    site_facts: crawl.site_facts === null ? null : record(crawl.site_facts),
    extractor_version: crawl.extractor_version,
    analyzer_version: crawl.analyzer_version,
    rule_version: crawl.rule_catalog_version,
    scoring_version: crawl.scoring_version,
    error_message: crawl.error_message,
    created_at: crawl.created_at.toISOString(),
    updated_at: crawl.updated_at.toISOString(),
    started_at: iso(crawl.started_at),
    completed_at: iso(crawl.completed_at),
  };
}

const FAILURE_MESSAGES: Record<string, string> = {
  dns_resolution_failed: 'The domain could not be resolved (DNS)',
  connection_failed: 'The site could not be reached (connection failed)',
  timeout: 'The site did not answer in time',
  robots_denied: "The site's robots.txt disallows the crawler from fetching the start URL",
  access_blocked:
    "Access blocked: the site answered robots.txt with 401/403, so the crawler stopped rather than work around the site's access controls",
  robots_unavailable:
    "The site's robots.txt could not be read (server error, rate limit or network failure), so fetching paused (a temporary disallow)",
  bot_blocked: 'The site answered the start URL with a bot-protection challenge',
  ssrf_blocked: 'The start URL is not permitted by the crawl safety policy',
  redirect_limit: 'The start URL redirected too many times',
  response_too_large: "The start URL's response was too large to process",
  unsupported_content_type: 'The start URL did not return an HTML page',
  malformed_response: 'The site returned a response that could not be read',
};

/** One sentence for a root failure: HTTP failures name the status, retries the attempts. */
export function failureMessage(code: string, statusCode: number | null, attempts: number | null) {
  const tries = Math.max(attempts ?? 0, 1);
  if ((code === 'http_4xx' || code === 'http_5xx') && statusCode !== null) {
    return code === 'http_5xx' && tries > 1
      ? `The site returned HTTP ${statusCode} after ${tries} attempts`
      : `The site returned HTTP ${statusCode} for the start URL`;
  }
  const base = FAILURE_MESSAGES[code];
  if (base === undefined) return 'The crawl failed before it could fetch the start URL';
  return tries > 1 ? `${base} after ${tries} attempts` : base;
}

/**
 * A failed crawl's root failure: the summary and the root fetch's failed
 * calls. Only a terminally failed root discover task has one; a root that
 * recovered after retries leaves nothing to report.
 */
export async function rootFailure(db: Database, crawl: Crawl) {
  if (crawl.status !== 'failed') return { summary: null, errors: [] };
  const workspace = new WorkspaceScope(crawl.workspace_id);
  const task = await workspace
    .selectFrom(db, 'site_crawl_tasks')
    .select(['id', 'status', 'error_code', 'attempt_count', 'requested_url'])
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'discover')
    .where('depth', '=', 0)
    .orderBy('generation', 'desc')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  if (task?.status !== 'failed') return { summary: null, errors: [] };
  const attempts = await workspace
    .selectFrom(db, 'site_fetch_attempts')
    .select(['method', 'outcome', 'error_code', 'status_code', 'latency_ms'])
    .where('task_id', '=', task.id)
    .orderBy('attempt_number')
    .orderBy('request_ordinal')
    .execute();
  const target = task.requested_url || crawl.root_url;
  const terminal = attempts.at(-1);
  const code = terminal?.error_code || task.error_code || '';
  const statusCode = terminal?.status_code ?? null;
  const attemptCount = task.attempt_count || null;
  return {
    summary: {
      code,
      message: failureMessage(code, statusCode, attemptCount),
      attempts: attemptCount,
      status_code: statusCode,
      target_url: target,
    },
    errors: attempts
      .filter((row) => row.outcome === reads.fetch_attempt_error_outcome)
      .map((row) => ({
        method: row.method || 'GET',
        target,
        outcome: row.outcome,
        error_code: row.error_code,
        status_code: row.status_code,
        latency_ms: row.latency_ms,
      })),
  };
}

/**
 * The task a page's status reads (alias `t`): its analysis, else a fetch that
 * failed for good, so a URL that could never be fetched counts and lists as
 * an error. A URL the crawl's own policy excluded is not one.
 */
export const ROW_TASK = sql`(t.task_kind = 'analyze'
  or (t.task_kind = 'discover' and t.status = 'failed'
    and t.error_code <> all(${reads.corpus_exclusion_error_codes}::text[])))`;
/** Which `ROW_TASK` row wins: the analysis, then the latest generation. */
export const ROW_TASK_ORDER = sql`t.task_kind = 'analyze' desc, t.generation desc`;

/** Live task counters for the dashboard's selected crawl. */
export async function crawlCounters(db: Database, crawl: Crawl): Promise<Counters> {
  const blocking = reads.policy_blocking_error_codes;
  const nonErrors = reads.non_error_terminal_codes;
  const exclusions = reads.corpus_exclusion_error_codes;
  const counts = await sql<{
    queued: number;
    running: number;
    analyzed: number;
    failed: number;
    blocked: number;
    not_errors: number;
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
      count(*) filter (where status = 'failed' and error_code = any(${blocking}::text[]))::int as blocked,
      count(*) filter (where status = 'failed' and error_code = any(${nonErrors}::text[]))::int as not_errors,
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
    from latest`.execute(db);
  const c = firstOf(counts.rows, 'the crawl task counters');
  const [selected, kinds, excluded] = await Promise.all([
    db
      .selectFrom('monitored_site_urls')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('workspace_id', '=', crawl.workspace_id)
      .where('project_id', '=', crawl.project_id)
      .where('active', '=', true)
      .executeTakeFirstOrThrow(),
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
        and error_code = any(${exclusions}::text[]) and url_hash <> ''`.execute(db),
  ]);
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
    selected: Number(selected.count),
    queued: c.queued,
    running: c.running,
    analyzed: c.analyzed,
    errors: Math.max(c.failed - c.not_errors, 0),
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
