/**
 * Workspace-scoped crawl loading, the per-page-latest crawl view every Site
 * Health read shares, and a failed crawl's root failure. A foreign or missing
 * crawl is a 404; nothing here writes.
 */
import {
  ACTIVE_CRAWL_STATUSES,
  isTerminalCrawl,
  isUsableCrawl,
  USABLE_CRAWL_STATUSES,
} from '@citeladder/contracts/site-health';
import { sql, type RawBuilder } from 'kysely';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record, strings } from '../../db/json.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import { notFound } from '../../errors.ts';
import { parseUuid } from '../../http/uuid.ts';
import { isPageRerun, pageRerunSql } from '../page-rerun.ts';
import type { Crawl } from '../site-task.ts';
import { siteLevelRuleOf } from './rules.ts';

const reads = policy.site_health.reads;

export type { Crawl };
export type FailureSummary = {
  code: string;
  message: string;
  attempts: number | null;
  status_code: number | null;
  target_url: string;
};

export const isTerminal = (crawl: Crawl) => isTerminalCrawl(crawl.status);

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

/** The project's site crawls, newest first: every crawl except one-page reruns. */
function siteCrawls(db: Database, workspaceId: string, projectId: string) {
  return new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_crawls')
    .where('project_id', '=', projectId)
    .where(sql<boolean>`not ${pageRerunSql}`)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');
}

/**
 * The current crawl as a one-row query, for callers that choose their own
 * columns: the project's newest usable crawl that is not a one-page rerun
 * (SH-B1). A rerun updates only its own page's evidence; it never becomes the
 * site evidence Site Health, Opportunities, Overview, the Agent, MCP, AI
 * Traffic, verification or internal links read; each reads every page's latest
 * audit as that crawl shows it (`pageAuditsSql`, SH-B9). `completedAfter`
 * narrows it to crawls that finished after a moment, for verifying a
 * backdated declaration.
 */
export function currentSiteCrawlQuery(
  db: Database,
  workspaceId: string,
  projectId: string,
  { completedAfter }: { completedAfter?: string } = {},
) {
  let usable = siteCrawls(db, workspaceId, projectId).where('status', 'in', USABLE_CRAWL_STATUSES);
  if (completedAfter !== undefined)
    usable = usable.where('completed_at', '>', sql<Date>`${completedAfter}::timestamptz`);
  return usable.limit(1);
}

/** The current crawl (`currentSiteCrawlQuery`), or `null` before the project has one. */
export async function currentSiteCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<Crawl | null> {
  const crawl = await currentSiteCrawlQuery(db, workspaceId, projectId)
    .selectAll()
    .executeTakeFirst();
  return crawl ?? null;
}

/** The crawl fields a per-page-latest view reads. */
export type ViewCrawl = Pick<
  Crawl,
  'id' | 'workspace_id' | 'project_id' | 'created_at' | 'configuration'
>;

/** When a crawl began auditing (alias `alias`): its start, else its creation. */
function auditAt(alias: string) {
  const started = sql.ref(alias + '.started_at');
  const created = sql.ref(alias + '.created_at');
  return sql`coalesce(${started}, ${created})`;
}

/**
 * When the site crawl after `crawl` began auditing: its view's upper bound,
 * or null while `crawl` is the newest usable site crawl.
 */
function nextSiteAudit(crawl: ViewCrawl) {
  return sql`(select min(${auditAt('n')}) from site_crawls n
    where n.workspace_id = ${crawl.workspace_id} and n.project_id = ${crawl.project_id}
      and not coalesce(n.configuration->>'page_rerun' = 'true', false)
      and n.status = any(${USABLE_CRAWL_STATUSES}::text[])
      and (n.created_at, n.id) > (${crawl.created_at}::timestamptz, ${crawl.id}::uuid))`;
}

/** A tracked page of the crawl's project: its page column is `siteUrlId`. */
function trackedPage(crawl: ViewCrawl, siteUrlId: RawBuilder<unknown>) {
  return sql`exists (
    select 1 from monitored_site_urls m
    where m.workspace_id = ${crawl.workspace_id} and m.project_id = ${crawl.project_id}
      and m.site_url_id = ${siteUrlId} and m.active and m.fill_order is not null)`;
}

/**
 * Each page's latest audit as a site crawl shows it (SH-B9): one row per page,
 * `(site_url_id, crawl_id, analysis_id)`. A site crawl shows, for every page it
 * audited and every tracked page, the newest finalized current analysis from
 * any audit of the project (the crawl itself, a page rerun or an earlier
 * crawl) that began before the next site crawl. So the current crawl reads
 * each tracked page's latest audit: a rerun landing after it moves its page,
 * and a page a cancelled crawl never reached keeps its earlier audit. The
 * crawl's own current analyses count before they are finalized, so a running
 * crawl shows its progress. A page rerun shows its own page only. `page`
 * narrows the relation to one page reference for a lateral join.
 *
 * The read stays bounded by the tracked set, never the project's history: it
 * takes the crawl's own analyses and those of audits that began after it
 * (through `uq_site_page_analysis_current`), and looks further back, one page
 * at a time, only for a tracked page the crawl never analyzed. An earlier
 * audit cannot outrank the crawl's own analysis of a page.
 */
export function pageAuditsSql(crawl: ViewCrawl, page?: RawBuilder<unknown>) {
  const onePage = (column: string) => (page ? sql`and ${sql.ref(column)} = ${page}` : sql``);
  if (isPageRerun(crawl))
    return sql`select distinct on (a.site_url_id) a.site_url_id, a.crawl_id, a.id as analysis_id
      from site_page_analyses a
      where a.workspace_id = ${crawl.workspace_id} and a.crawl_id = ${crawl.id} and a.is_current
        ${onePage('a.site_url_id')}
      order by a.site_url_id, a.created_at desc, a.id desc`;
  const before = sql`coalesce(${nextSiteAudit(crawl)}, 'infinity'::timestamptz)`;
  const began = sql`(select ${auditAt('x')} from site_crawls x
    where x.workspace_id = ${crawl.workspace_id} and x.id = ${crawl.id})`;
  return sql`select distinct on (v.site_url_id) v.site_url_id, v.crawl_id, v.analysis_id
    from (
      -- The crawl's own analyses, and the tracked pages' audits since it began.
      select a.site_url_id, a.crawl_id, a.id as analysis_id, a.created_at, ${auditAt('c')} as audit_at
      from site_crawls c
      join site_page_analyses a
        on a.workspace_id = c.workspace_id and a.crawl_id = c.id and a.is_current
      where c.workspace_id = ${crawl.workspace_id} and c.project_id = ${crawl.project_id}
        ${onePage('a.site_url_id')}
        and (c.id = ${crawl.id} or (${auditAt('c')} >= ${began} and ${auditAt('c')} < ${before}))
        and (c.id = ${crawl.id} or (
          a.finalized_at is not null and ${trackedPage(crawl, sql.ref('a.site_url_id'))}))
      union all
      -- A tracked page the crawl never analyzed: its newest earlier audit.
      select f.* from monitored_site_urls m
      cross join lateral (
        select a.site_url_id, a.crawl_id, a.id as analysis_id, a.created_at,
          ${auditAt('c')} as audit_at
        from site_page_analyses a
        join site_crawls c on c.workspace_id = a.workspace_id and c.id = a.crawl_id
        where a.workspace_id = m.workspace_id and a.project_id = m.project_id
          and a.site_url_id = m.site_url_id and a.is_current and a.finalized_at is not null
          and ${auditAt('c')} < ${before}
        order by audit_at desc, a.created_at desc, a.id desc limit 1
      ) f
      where m.workspace_id = ${crawl.workspace_id} and m.project_id = ${crawl.project_id}
        and m.active and m.fill_order is not null ${onePage('m.site_url_id')}
        and not exists (
          select 1 from site_page_analyses own
          where own.workspace_id = m.workspace_id and own.crawl_id = ${crawl.id}
            and own.site_url_id = m.site_url_id and own.is_current)
    ) v
    order by v.site_url_id, v.audit_at desc, v.created_at desc, v.analysis_id desc`;
}

/**
 * The crawl's pages at their latest audit (`pageAuditsSql`), each analysis
 * `a` with its fetch `f` and URL `u`, for readers that choose their columns.
 */
export function latestPagesQuery(db: Database, crawl: ViewCrawl) {
  return db
    .selectFrom('site_page_analyses as a')
    .innerJoin('site_fetch_artifacts as f', (join) =>
      join
        .onRef('f.id', '=', 'a.artifact_id')
        .onRef('f.workspace_id', '=', 'a.workspace_id')
        .onRef('f.crawl_id', '=', 'a.crawl_id'),
    )
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'a.site_url_id')
        .onRef('u.workspace_id', '=', 'a.workspace_id')
        .onRef('u.project_id', '=', 'a.project_id'),
    )
    .where('a.workspace_id', '=', crawl.workspace_id)
    .where('a.project_id', '=', crawl.project_id)
    .where('a.id', 'in', sql<string>`(select v.analysis_id from (${pageAuditsSql(crawl)}) v)`);
}

/**
 * The issues a site crawl shows (alias `alias`): each page's current issues
 * from its latest audit (`pageAuditsSql`), and the crawl's own site-level
 * findings (architecture and sitewide links), which only a site crawl
 * evaluates. A page rerun shows its own current issues. The crawls the view
 * names bound the read to their current issues (`ix_site_issues_current`).
 */
export function viewIssuesSql(crawl: ViewCrawl, alias = 'i') {
  const ref = (column: string) => sql.ref(`${alias}.${column}`);
  const own = sql`${ref('workspace_id')} = ${crawl.workspace_id} and ${ref('crawl_id')} = ${crawl.id}
    and ${ref('is_current')}`;
  if (isPageRerun(crawl)) return own;
  const siteLevel = siteLevelRuleOf(alias);
  const view = pageAuditsSql(crawl);
  return sql`${ref('workspace_id')} = ${crawl.workspace_id} and ${ref('project_id')} = ${crawl.project_id}
    and ${ref('is_current')}
    and ${ref('crawl_id')} = any(array(
      select ${crawl.id}::uuid union select v.crawl_id from (${view}) v))
    and (
      (${siteLevel} and ${ref('crawl_id')} = ${crawl.id})
      or (not ${siteLevel} and (${ref('crawl_id')}, ${ref('site_url_id')}) in (
        select v.crawl_id, v.site_url_id from (${view}) v)))`;
}

/**
 * The site crawl a page rerun lands in: the newest usable site crawl created
 * before it, whose view (`pageAuditsSql`) folds the rerun's page. Null for a
 * site crawl or before any site crawl is usable.
 */
export async function foldingSiteCrawl(db: Database, rerun: Crawl): Promise<Crawl | null> {
  if (!isPageRerun(rerun)) return null;
  const crawl = await siteCrawls(db, rerun.workspace_id, rerun.project_id)
    .selectAll()
    .where('status', 'in', USABLE_CRAWL_STATUSES)
    .where(sql<boolean>`(created_at, id) < (${rerun.created_at}::timestamptz, ${rerun.id}::uuid)`)
    .executeTakeFirst();
  return crawl ?? null;
}

/**
 * The newest landed page rerun that folds into the current site crawl's view
 * (`foldingSiteCrawl`), or null: the revision of that view since the crawl
 * finished, for readers keyed on the crawl, such as the Opportunity refresh.
 */
export async function foldedRerunId(db: Database, current: ViewCrawl): Promise<string | null> {
  const rerun = await new WorkspaceScope(current.workspace_id)
    .selectFrom(db, 'site_crawls')
    .select('id')
    .where('project_id', '=', current.project_id)
    .where(pageRerunSql)
    .where('status', 'in', USABLE_CRAWL_STATUSES)
    .where(
      sql<boolean>`(created_at, id) > (${current.created_at}::timestamptz, ${current.id}::uuid)`,
    )
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return rerun?.id ?? null;
}

/** The current crawl's newest Site Health snapshot, as a one-row query. */
export function currentSiteSnapshotQuery(db: Database, workspaceId: string, projectId: string) {
  return new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_health_snapshots')
    .where('project_id', '=', projectId)
    .where('crawl_id', '=', currentSiteCrawlQuery(db, workspaceId, projectId).select('id'))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1);
}

/**
 * The named crawl or, without one, the crawl the dashboard shows: a running
 * site crawl, so its progress stays visible; else the current crawl; else the
 * newest site crawl, so a project whose crawls all failed still sees why. A
 * page rerun is never the default. The caller's route has authorized the
 * project; a crawl outside it is a 404 and a project with no crawl is `null`.
 */
export async function dashboardCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
): Promise<Crawl | null> {
  if (crawlId !== null) return loadProjectCrawl(db, workspaceId, projectId, crawlId);
  const crawls = siteCrawls(db, workspaceId, projectId).selectAll();
  const active = await crawls.where('status', 'in', ACTIVE_CRAWL_STATUSES).executeTakeFirst();
  if (active !== undefined) return active;
  return (
    (await currentSiteCrawl(db, workspaceId, projectId)) ??
    (await crawls.executeTakeFirst()) ??
    null
  );
}

/**
 * The named crawl (404 when foreign) or the current crawl; only a named crawl
 * may be a page rerun. A named crawl that has not reached a usable terminal
 * state, or a project with none, is `null`: the caller renders its own
 * "nothing yet" state. The caller's route has authorized the project.
 */
export async function resolveUsableCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
): Promise<Crawl | null> {
  if (crawlId === null) return currentSiteCrawl(db, workspaceId, projectId);
  const crawl = await loadProjectCrawl(db, workspaceId, projectId, crawlId);
  return isUsableCrawl(crawl.status) ? crawl : null;
}

async function loadProjectCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string,
) {
  const crawl = await new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_crawls')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('id', '=', crawlId)
    .executeTakeFirst();
  if (crawl === undefined) throw notFound('Crawl');
  return crawl;
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
