/** Each population reaches one row per path hash before the cross-signal join. */
import { sql, type RawBuilder } from 'kysely';
import type { Database } from '../db/database.ts';
import type { CrawlScope } from '../crawl-logs/state.ts';
import {
  crawlWindow,
  verificationFilter,
  windowBounds,
  withReportingTimezone,
  type CrawlReadOptions,
} from '../crawl-logs/reads.ts';
import { citationRuns } from './citation-runs.ts';
import { crawlers } from '../config/crawlers.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import { ApiError } from '../errors.ts';
import { shownIssueFilter } from '../site-health/reads/page-rows.ts';
import { currentSiteCrawl, inventoryCrawlIds, pageAuditsSql } from '../site-health/reads/crawl.ts';

export type PageOptions = CrawlReadOptions & {
  sort?: string | null;
  url_hash?: string;
  url_hashes?: string[];
  pattern?: string | null;
  after?: string[];
  dataset_limit?: number;
  /** Aggregate each row's source ids (`crawl_ids`, `landing_ids`, `citation_ids`, `audit_ids`). */
  provenance?: boolean;
};
export const pageSorts = {
  requests_desc: 'requests',
  sessions_desc: 'sessions',
  key_events_desc: 'key_events',
  citations_desc: 'citations',
  url_asc: 'canonical_url',
} as const;

export type JoinedPage = {
  url_hash: string;
  canonical_url: string;
  display_path: string;
  folder: string;
  resource_class: string;
  requests: number | null;
  verified_requests: number | null;
  ai_requests: number | null;
  verified_errors: unknown;
  errors_4xx: number | null;
  errors_5xx: number | null;
  last_crawl: string | null;
  sessions: number | null;
  key_events: number | null;
  analytics_quality: unknown;
  crawl_timezones: unknown;
  referral_timezones: unknown;
  citations: number | null;
  findings: number | null;
  crawl_ids: unknown;
  landing_ids: unknown;
  citation_ids: unknown;
  audit_ids: unknown;
};
function pageCursor(sortValue: RawBuilder<unknown>, ascending: boolean, after: string[]) {
  if (!after.length) return sql`true`;
  const [sortAfter, hashAfter] = after;
  if (
    after.length !== 2 ||
    hashAfter === undefined ||
    !/^[a-f0-9]{64}$/u.test(hashAfter) ||
    (!ascending && !Number.isFinite(Number(sortAfter)))
  )
    throw new ApiError(422, 'Invalid Pages cursor');
  if (ascending) return sql`(${sortValue},url_hash)>(${sortAfter},${hashAfter})`;
  return sql`(${sortValue},url_hash)<(${Number(sortAfter)},${hashAfter})`;
}
/** A Pages sort key; an unknown one is refused. */
export function pageSortKey(sort?: string | null): keyof typeof pageSorts {
  if (sort === null || sort === undefined) return 'requests_desc';
  if (!isPageSort(sort)) throw new ApiError(422, 'Invalid Pages sort');
  return sort;
}
function isPageSort(sort: string): sort is keyof typeof pageSorts {
  return Object.hasOwn(pageSorts, sort);
}
/**
 * The joined rows for a page, `dataset_limit` (else one past the page size)
 * after the keyset position, in sort order. Provenance id arrays aggregate
 * only for `provenance`, the persisted insight derivation; reads leave them null.
 */
export async function pageDataset(db: Database, scope: CrawlScope, input: PageOptions = {}) {
  const { options, crawl, filtered } = await pageSelection(db, scope, input);
  const sort = pageSortKey(options.sort);
  const ascending = sort === 'url_asc',
    column = sql.ref(pageSorts[sort]);
  const sortValue = ascending ? column : sql`coalesce(${column},-1)`;
  const cursor = pageCursor(sortValue, ascending, options.after ?? []);
  const rows = await sql<JoinedPage>`select * from (${filtered}) f where ${cursor}
    order by ${sortValue} ${sql.raw(ascending ? 'asc' : 'desc')},url_hash ${sql.raw(ascending ? 'asc' : 'desc')}
    limit ${options.dataset_limit ?? (options.limit ?? crawlLogs.default_page_size) + 1}`.execute(
    db,
  );
  return { rows: rows.rows, crawl };
}
/** How many rows the filters select across the whole window; an export counts before it reads. */
export async function pageCount(db: Database, scope: CrawlScope, input: PageOptions = {}) {
  const { filtered } = await pageSelection(db, scope, input);
  const result = await sql<{
    count: number;
  }>`select count(*)::integer as count from (${filtered}) f`.execute(db);
  return result.rows[0]?.count ?? 0;
}
async function pageSelection(db: Database, scope: CrawlScope, input: PageOptions) {
  const options = await withReportingTimezone(db, scope, input);
  const w = crawlWindow(options),
    verification = verificationFilter(options.verification);
  const crawl = await currentSiteCrawl(db, scope.workspaceId, scope.projectId);
  const owned = sql`workspace_id=${scope.workspaceId}::uuid and project_id=${scope.projectId}::uuid`;
  const days = sql`reporting_date between ${w.start}::date and ${w.end}::date`;
  const botFilter = options.bot_id ? sql`bot_id=${options.bot_id}` : sql`true`;
  const ids = (aggregate: RawBuilder<unknown>) =>
    options.provenance ? aggregate : sql`null::jsonb`;
  const rollupIds = ids(sql`jsonb_agg(id)`),
    citationIds = ids(sql`jsonb_agg(c.id order by r.audit_id,c.n)`),
    auditIds = ids(sql`jsonb_agg(distinct r.audit_id)`);
  const rowConditions = [sql`canonical_url is not null`];
  if (options.url_hash) rowConditions.push(sql`url_hash=${options.url_hash}`);
  if (options.url_hashes) rowConditions.push(sql`url_hash=any(${options.url_hashes}::text[])`);
  if (options.folder) rowConditions.push(sql`folder=${options.folder}`);
  if (options.resource_class) rowConditions.push(sql`resource_class=${options.resource_class}`);
  const rowFilter = sql.join(rowConditions, sql` and `);
  const path = sql`regexp_replace(canonical_url,'^https?://[^/]+','')`;
  const resources = sql`case ${sql.join(
    crawlers.resource_rules.map(
      (rule) =>
        sql`when ${sql.join(
          [
            ...rule.paths.map((p) => sql`lower(${path})=${p.toLowerCase()}`),
            ...rule.extensions.map(
              (e) => sql`right(lower(${path}),${e.length})=${e.toLowerCase()}`,
            ),
          ],
          sql` or `,
        )} then ${rule.resource_class}`,
    ),
    sql` `,
  )} else 'page' end`;
  const filtered = sql`with
    bot as (select url_hash,min(canonical_url) as canonical_url,min(display_path) as display_path,min(folder) as folder,min(resource_class) as resource_class,sum(requests)::integer as requests,
      sum(requests) filter(where verification='verified' and bot_id in (select value from jsonb_array_elements_text(${JSON.stringify(aiBots())}::jsonb)))::integer as verified_requests,
      sum(requests) filter(where bot_id in (select value from jsonb_array_elements_text(${JSON.stringify(aiBots(true))}::jsonb)))::integer as ai_requests,
      sum(requests) filter(where status_code between 400 and 499)::integer as errors_4xx,
      sum(requests) filter(where status_code>=500)::integer as errors_5xx,
      to_char(max(last_seen_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_crawl,
      jsonb_agg(distinct reporting_timezone) as crawl_timezones,${rollupIds} as crawl_ids
      from bot_activity_daily where ${owned} and ${days} and identity='exact' and url_hash is not null
        and verification=any(${verification}::text[]) and ${botFilter} group by url_hash),
    errors as (select url_hash,jsonb_object_agg(status_code,n) as verified_errors from
      (select url_hash,status_code,sum(requests)::integer n from bot_activity_daily where ${owned} and ${days}
        and identity='exact' and verification='verified' and status_code>=400
        and ${botFilter} group by url_hash,status_code) e group by url_hash),
    landing as (select url_hash,min(canonical_url) as canonical_url,min(display_path) as display_path,min(folder) as folder,min(resource_class) as resource_class,sum(sessions)::integer as sessions,sum(key_events) as key_events,
      jsonb_agg(distinct reporting_timezone) as referral_timezones,${rollupIds} as landing_ids,
      (select coalesce(jsonb_agg(distinct flag),'[]') from ai_referral_landing_daily q,
        jsonb_array_elements_text(q.analytics_quality) flag where q.workspace_id=${scope.workspaceId}::uuid
        and q.project_id=${scope.projectId}::uuid and q.url_hash=l.url_hash and q.reporting_date between ${w.start}::date and ${w.end}::date) as analytics_quality
      from ai_referral_landing_daily l where ${owned} and ${days} group by url_hash),
    citation_runs as (${citationRuns(db, scope, windowBounds(w, options)).select('m.owned_citation_pages')}),
    citation as (select p.url_hash,min(p.canonical_url) as canonical_url,count(*)::integer as citations,${citationIds} as citation_ids,${auditIds} as audit_ids
      from citation_runs r cross join lateral jsonb_to_recordset(r.owned_citation_pages) as p(url_hash text,canonical_url text,citation_ids jsonb)
        cross join lateral jsonb_array_elements_text(p.citation_ids) with ordinality as c(id,n) group by p.url_hash),
    inventory as (select distinct u.url_hash,u.normalized_url as canonical_url from site_urls u
      join site_url_observations o on o.site_url_id=u.id and o.workspace_id=u.workspace_id and o.project_id=u.project_id
      where u.workspace_id=${scope.workspaceId}::uuid and u.project_id=${scope.projectId}::uuid and o.crawl_id=any(${crawl ? inventoryCrawlIds(crawl) : []}::uuid[])),
    finding as (select u.url_hash,count(i.id)::integer as findings from site_page_analyses a join site_urls u
      on u.id=a.site_url_id and u.workspace_id=a.workspace_id and u.project_id=a.project_id
      left join site_issues i on i.workspace_id=a.workspace_id and i.project_id=a.project_id
        and ${crawl ? shownIssueFilter(crawl, 'i', 'a') : sql`false`}
      where a.workspace_id=${scope.workspaceId}::uuid and a.project_id=${scope.projectId}::uuid
        and ${crawl ? sql`a.id in (select v.analysis_id from (${pageAuditsSql(crawl)}) v)` : sql`false`}
      group by u.url_hash),
    keys as (select url_hash from bot union select url_hash from landing union select url_hash from citation union select url_hash from inventory)
    ,joined as (select k.url_hash,coalesce(l.canonical_url,i.canonical_url,c.canonical_url,b.canonical_url) as canonical_url,
      coalesce(b.display_path,l.display_path) as stored_display_path,coalesce(b.folder,l.folder) as stored_folder,coalesce(b.resource_class,l.resource_class) as stored_resource_class,
      b.requests,b.verified_requests,b.ai_requests,b.errors_4xx,b.errors_5xx,b.last_crawl,b.crawl_timezones,b.crawl_ids,
      l.sessions,l.key_events,l.analytics_quality,l.referral_timezones,l.landing_ids,c.citations,c.citation_ids,c.audit_ids,f.findings,e.verified_errors
    from keys k left join bot b using(url_hash) left join landing l using(url_hash) left join citation c using(url_hash)
      left join inventory i using(url_hash) left join finding f using(url_hash) left join errors e using(url_hash))
    ,formatted as (select *,coalesce(stored_display_path,${path}) as display_path,
      coalesce(stored_folder,
        '/'||array_to_string((string_to_array(trim(both '/' from ${path}),'/'))[1:${crawlLogs.folder_depth}],'/')) as folder,
      coalesce(stored_resource_class,${resources}) as resource_class from joined)
    select * from formatted where ${rowFilter}`;
  return { options, crawl, filtered };
}
export function aiBots(includeTraining = false) {
  return crawlers.bots
    .filter(
      (b) =>
        b.purpose === 'ai_search' ||
        b.purpose === 'ai_user_fetch' ||
        (includeTraining && b.purpose === 'ai_training'),
    )
    .map((b) => b.bot_id);
}
