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
import { CRAWL_COLUMNS, type Crawl, type ProjectedCrawl } from '../site-task.ts';
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

const crawlRow = (db: Database, workspaceId: string, crawlId: string) =>
  new WorkspaceScope(workspaceId).selectFrom(db, 'site_crawls').where('id', '=', crawlId);

export async function loadCrawl(db: Database, workspaceId: string, crawlId: string) {
  const crawl = await crawlRow(db, workspaceId, crawlId).select(CRAWL_COLUMNS).executeTakeFirst();
  if (crawl === undefined) throw notFound('Crawl');
  return crawl;
}

export async function loadProjectedCrawl(db: Database, workspaceId: string, crawlId: string) {
  const crawl = await crawlRow(db, workspaceId, crawlId).selectAll().executeTakeFirst();
  if (crawl === undefined) throw notFound('Crawl');
  return crawl;
}

function siteCrawls(db: Database, workspaceId: string, projectId: string) {
  return new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_crawls')
    .where('project_id', '=', projectId)
    .where(sql<boolean>`not ${pageRerunSql}`)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc');
}

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

export async function currentSiteCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<ProjectedCrawl | null> {
  const crawl = await currentSiteCrawlQuery(db, workspaceId, projectId)
    .selectAll()
    .executeTakeFirst();
  return crawl ?? null;
}

export type ViewCrawl = Pick<
  Crawl,
  'id' | 'workspace_id' | 'project_id' | 'created_at' | 'configuration'
>;

function auditAt(alias: string) {
  const started = sql.ref(alias + '.started_at');
  const created = sql.ref(alias + '.created_at');
  return sql`coalesce(${started}, ${created})`;
}

function nextSiteAudit(crawl: ViewCrawl) {
  return sql`(select min(${auditAt('n')}) from site_crawls n
    where n.workspace_id = ${crawl.workspace_id} and n.project_id = ${crawl.project_id}
      and not coalesce(n.configuration->>'page_rerun' = 'true', false)
      and n.status = any(${USABLE_CRAWL_STATUSES}::text[])
      and (n.created_at, n.id) > (${crawl.created_at}::timestamptz, ${crawl.id}::uuid))`;
}

function trackedPage(crawl: ViewCrawl, siteUrlId: RawBuilder<unknown>) {
  return sql`exists (
    select 1 from monitored_site_urls m
    where m.workspace_id = ${crawl.workspace_id} and m.project_id = ${crawl.project_id}
      and m.site_url_id = ${siteUrlId} and m.active and m.fill_order is not null)`;
}

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
      -- The crawl's own analyses.
      select a.site_url_id, a.crawl_id, a.id as analysis_id, a.created_at, ${began} as audit_at
      from site_page_analyses a
      where a.workspace_id = ${crawl.workspace_id} and a.crawl_id = ${crawl.id} and a.is_current
        ${onePage('a.site_url_id')}
      union all
      -- Other audits of tracked pages: those since the crawl began, and earlier
      -- ones for a page the crawl never analyzed. Led by the project's other
      -- crawls, so a project with one crawl reads nothing here.
      select a.site_url_id, a.crawl_id, a.id as analysis_id, a.created_at, ${auditAt('c')} as audit_at
      from site_crawls c
      join site_page_analyses a on a.workspace_id = c.workspace_id and a.crawl_id = c.id
        and a.is_current and a.finalized_at is not null
      where c.workspace_id = ${crawl.workspace_id} and c.project_id = ${crawl.project_id}
        and c.id <> ${crawl.id} and ${auditAt('c')} < ${before} ${onePage('a.site_url_id')}
        and ${trackedPage(crawl, sql.ref('a.site_url_id'))}
        -- Uncorrelated, so the crawl's own pages are hashed once.
        and (${auditAt('c')} >= ${began} or a.site_url_id not in (
          select own.site_url_id from site_page_analyses own
          where own.workspace_id = ${crawl.workspace_id} and own.crawl_id = ${crawl.id}
            and own.is_current))
    ) v
    order by v.site_url_id, v.audit_at desc, v.created_at desc, v.analysis_id desc`;
}

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

export function viewIssuesSql(crawl: ViewCrawl, alias = 'i', view?: RawBuilder<unknown>) {
  const ref = (column: string) => sql.ref(`${alias}.${column}`);
  const own = sql`${ref('workspace_id')} = ${crawl.workspace_id} and ${ref('crawl_id')} = ${crawl.id}
    and ${ref('is_current')}`;
  if (isPageRerun(crawl)) return own;
  const siteLevel = siteLevelRuleOf(alias);
  const pages = view ?? sql`(${pageAuditsSql(crawl)})`;
  return sql`${ref('workspace_id')} = ${crawl.workspace_id} and ${ref('project_id')} = ${crawl.project_id}
    and ${ref('is_current')}
    and ${ref('crawl_id')} = any(array(
      select ${crawl.id}::uuid union select v.crawl_id from ${pages} v))
    and (
      (${siteLevel} and ${ref('crawl_id')} = ${crawl.id})
      or (not ${siteLevel} and (${ref('crawl_id')}, ${ref('site_url_id')}) in (
        select v.crawl_id, v.site_url_id from ${pages} v)))`;
}

function usableSiteCrawls(db: Database, crawl: ViewCrawl) {
  return siteCrawls(db, crawl.workspace_id, crawl.project_id)
    .select(['id', 'workspace_id', 'project_id', 'configuration', 'started_at', 'created_at'])
    .where('status', 'in', USABLE_CRAWL_STATUSES);
}

const crawlKey = (crawl: ViewCrawl) => sql`(${crawl.created_at}::timestamptz, ${crawl.id}::uuid)`;

export async function adjacentSiteCrawls(db: Database, crawl: ViewCrawl) {
  const [previous, next] = await Promise.all([
    usableSiteCrawls(db, crawl)
      .where(sql<boolean>`(created_at, id) < ${crawlKey(crawl)}`)
      .limit(1)
      .executeTakeFirst(),
    usableSiteCrawls(db, crawl)
      .where(sql<boolean>`(created_at, id) > ${crawlKey(crawl)}`)
      .clearOrderBy()
      .orderBy('created_at')
      .orderBy('id')
      .limit(1)
      .executeTakeFirst(),
  ]);
  return { previous: previous ?? null, next: next ?? null };
}

export async function foldingSiteCrawl(db: Database, rerun: Crawl): Promise<Crawl | null> {
  if (!isPageRerun(rerun)) return null;
  const crawl = await siteCrawls(db, rerun.workspace_id, rerun.project_id)
    .selectAll()
    .where('status', 'in', USABLE_CRAWL_STATUSES)
    .where(sql<boolean>`(created_at, id) < (${rerun.created_at}::timestamptz, ${rerun.id}::uuid)`)
    .executeTakeFirst();
  return crawl ?? null;
}

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

export function currentSiteSnapshotQuery(db: Database, workspaceId: string, projectId: string) {
  return new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_health_snapshots')
    .where('project_id', '=', projectId)
    .where('crawl_id', '=', currentSiteCrawlQuery(db, workspaceId, projectId).select('id'))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1);
}

export async function dashboardCrawl(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
): Promise<ProjectedCrawl | null> {
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

export const countDisclosure = (crawl: Crawl) =>
  record(crawl.configuration).count_disclosure === true;

function inheritedCrawlIds(crawl: Crawl): string[] {
  if (crawl.sample_mode) return [];
  const ids = strings(record(crawl.configuration)[reads.inventory_source_crawl_ids_key]).map(
    (value) => parseUuid(value),
  );
  return [...new Set(ids.filter((id): id is string => id !== null && id !== crawl.id))];
}

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
  tls_cert_expired: "The site's TLS certificate has expired",
  tls_cert_not_yet_valid: "The site's TLS certificate is not valid yet",
  tls_cert_self_signed: "The site's TLS certificate is self-signed",
  tls_cert_hostname_mismatch: "The site's TLS certificate does not name this domain",
  tls_cert_untrusted: "The site's TLS certificate chain is incomplete or not trusted",
  tls_cert_revoked: "The site's TLS certificate has been revoked",
  tls_cert_invalid: "The site's TLS certificate is invalid",
};

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
    .where('crawl_id', '=', crawl.id)
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
