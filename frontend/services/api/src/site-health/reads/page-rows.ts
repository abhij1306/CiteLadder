/**
 * One persisted page row per URL a crawl can show, filtered and keyset-paged
 * in a single query.
 *
 * A crawl shows the URLs it observed plus, for a full recrawl, the frozen
 * inventory of the crawls it inherits. A page's measurements and issues come
 * from its latest audit as the crawl shows it (`pageAuditsSql`, SH-B9): a
 * later page rerun, or an earlier audit of a page this crawl never reached.
 * The analyze task and the link metrics come from the crawl itself. The
 * presentation status is derived in SQL, so status filters page like any
 * other filter; the cursor cuts the window before the per-row projection.
 */
import { pageAnalysisStatusSchema } from '@citeladder/contracts/site-health';
import { sql, type RawBuilder } from 'kysely';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { containsPattern } from '../../db/like.ts';
import { parseUuid } from '../../http/uuid.ts';
import { failedAs } from '../task-outcome.ts';
import { inventoryCrawlIds, isTerminal, pageAuditsSql, type Crawl } from './crawl.ts';
import { ROW_TASK, ROW_TASK_ORDER } from './crawl-counters.ts';
import { siteLevelRuleOf } from './rules.ts';

const PERSISTED = ['completed', 'partially_completed'];
// The largest integer depth; an unmeasured page sorts after every measured one.
const UNMEASURED_DEPTH = 2_147_483_647;
const MAX_REFERRERS = policy.site_health.crawl.max_referrers_per_url;

export const PAGE_SORTS = ['status', 'url', 'inbound', 'main_content_inbound', 'depth'] as const;
export type PageSort = (typeof PAGE_SORTS)[number];

type SortSpec = { value: RawBuilder<unknown>; kind: 'text' | 'int'; descending: boolean };

const SORTS: Record<PageSort, SortSpec> = {
  // Measured pages first, then the rest, each by URL.
  status: {
    value: sql`(case when a.status = any(${PERSISTED}::text[]) then '0:' else '1:' end) || u.normalized_url`,
    kind: 'text',
    descending: false,
  },
  url: { value: sql`u.normalized_url`, kind: 'text', descending: false },
  inbound: { value: sql`coalesce(l.inbound_count, 0)`, kind: 'int', descending: true },
  main_content_inbound: {
    value: sql`coalesce(l.main_content_inbound_count, 0)`,
    kind: 'int',
    descending: true,
  },
  depth: {
    value: sql`coalesce(l.depth_from_home, ${UNMEASURED_DEPTH})`,
    kind: 'int',
    descending: false,
  },
};

/** The statuses a page filter takes: every presented status, plus both terminal failures. */
export const PAGE_STATUS_FILTERS = [
  ...pageAnalysisStatusSchema.exclude(['failed']).options,
  'error_or_blocked',
] as const;

export type PageRowFilters = {
  /** A presentation status, or `error_or_blocked` for both terminal failures. */
  status?: string | null;
  monitored?: boolean | null;
  pageKind?: string | null;
  /** Case-insensitive substring of the normalized or display URL. */
  query?: string | null;
  siteUrlId?: string;
  /** Pages whose current analysis reports an issue of this rule. */
  rule?: string | null;
};

export type PageRow = {
  site_url_id: string;
  crawl_id: string;
  normalized_url: string;
  display_url: string;
  title: string | null;
  content_type: string | null;
  source: string | null;
  depth: number | null;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
  monitored: boolean;
  analysis_id: string | null;
  analysis_status: string;
  error_code: string;
  page_kind: string | null;
  web_fundamentals_score: number | null;
  web_fundamentals_coverage: number | null;
  web_fundamentals_state: string;
  aeo_readiness_score: number | null;
  aeo_measurement_coverage: number | null;
  aeo_measurement_state: string;
  aeo_measurement_reason: string;
  main_content_indexable: boolean | null;
  /** The analyzed fetch was made despite a robots.txt exclusion. */
  robots_excluded: boolean;
  finalized_at: Date | null;
  issue_count: number | null;
  inbound_count: number | null;
  main_content_inbound_count: number | null;
  depth_from_home: number | null;
  sort_value: string | number;
};

/** The measurement fields every page projection carries; unmeasured without an analysis. */
export const measurementFields = (row: PageRow) => ({
  page_kind: row.page_kind,
  web_fundamentals_score: row.web_fundamentals_score,
  web_fundamentals_coverage: row.web_fundamentals_coverage,
  web_fundamentals_state: row.web_fundamentals_state,
  aeo_readiness_score: row.aeo_readiness_score,
  aeo_measurement_coverage: row.aeo_measurement_coverage,
  aeo_measurement_state: row.aeo_measurement_state,
  aeo_measurement_reason: row.aeo_measurement_reason,
  main_content_indexable: row.main_content_indexable,
  robots_excluded: row.robots_excluded,
  last_audited: row.finalized_at?.toISOString() ?? null,
  issue_count: row.issue_count,
});

/**
 * Issues of a page's current analysis: its own evaluations plus the
 * architecture findings attached to it.
 */
export function currentIssueFilter(issue: string, analysis: string) {
  const evaluation = sql.ref(issue + '.evaluation_id');
  const sources = sql.ref(analysis + '.source_evaluation_ids');
  const issueAnalysis = sql.ref(issue + '.analysis_id');
  const analysisId = sql.ref(analysis + '.id');
  return sql`(${evaluation} = any(${sources})
    or (${issueAnalysis} = ${analysisId} and exists(
      select 1 from site_rule_evaluations e
      where e.id = ${evaluation} and e.source_architecture_id is not null)))`;
}

/**
 * The issues `crawl` shows on the page whose latest audit is `analysis` (both
 * aliases): that audit's current issues, plus the crawl's own site-level
 * findings (architecture, sitewide links) on the page. Only a site crawl
 * evaluates those, so a later rerun of the root never drops them (SH-B9; the
 * same split as `viewIssuesSql`). The caller scopes the workspace.
 */
export function shownIssueFilter(crawl: Pick<Crawl, 'id'>, issue: string, analysis: string) {
  const ref = (alias: string, column: string) => sql.ref(`${alias}.${column}`);
  const siteLevel = siteLevelRuleOf(issue);
  return sql`(${ref(issue, 'site_url_id')} = ${ref(analysis, 'site_url_id')} and (
    (not ${siteLevel} and ${ref(issue, 'crawl_id')} = ${ref(analysis, 'crawl_id')}
      and ${currentIssueFilter(issue, analysis)})
    or (${siteLevel} and ${ref(issue, 'crawl_id')} = ${crawl.id}::uuid
      and ${ref(issue, 'is_current')})))`;
}

function statusFilter(status: string | null | undefined) {
  if (!status) return sql``;
  if (status === 'error_or_blocked') return sql`and analysis_status in ('error', 'blocked')`;
  return sql`and analysis_status = ${status}`;
}

/** Rows of the crawl's page window, `limit + 1` of them so the caller can see a next page. */
export async function pageRows(
  db: Database,
  crawl: Crawl,
  options: {
    filters: PageRowFilters;
    sort: PageSort;
    limit: number;
    after?: { value: string; id: string } | null;
  },
): Promise<PageRow[]> {
  const { filters, sort, limit, after } = options;
  const spec = SORTS[sort];
  const lineage = inventoryCrawlIds(crawl);
  const unmonitoredStatus = isTerminal(crawl) ? 'not_measured' : 'pending';
  const search = filters.query?.trim().toLowerCase();
  const pattern = search ? containsPattern(search) : null;
  let keyset = sql``;
  if (after) {
    const value =
      spec.kind === 'int' ? sql`${Number(after.value)}::int` : sql`${after.value}::text`;
    keyset = spec.descending
      ? sql`and (sort_value, site_url_id) < (${value}, ${after.id}::uuid)`
      : sql`and (sort_value, site_url_id) > (${value}, ${after.id}::uuid)`;
  }
  const direction = sql.raw(spec.descending ? 'desc' : 'asc');
  // The cursor and the order cut the window first (PERF-007): only its rows
  // pay for the projection's per-row subqueries.
  const result = await sql<PageRow>`
    with keyed as (
      select
        u.id as site_url_id,
        m.site_url_id is not null as monitored,
        a.id as analysis_id,
        case
          when a.status = any(${PERSISTED}::text[]) then a.status
          when t.status is null then
            case when m.site_url_id is not null then ${unmonitoredStatus} else 'not_selected' end
          when t.status = 'cancelled' then 'cancelled'
          when t.status = 'failed' then
            case when ${failedAs('t', ['blocked', 'excluded'])}
              then 'blocked' else 'error' end
          when t.status in ('running', 'leased') then 'running'
          else 'pending'
        end as analysis_status,
        case
          when a.status = any(${PERSISTED}::text[]) then ''
          when t.status in ('cancelled', 'failed') then coalesce(t.error_code, '')
          else ''
        end as error_code,
        l.inbound_count,
        l.main_content_inbound_count,
        l.depth_from_home,
        ${spec.value} as sort_value
      from site_urls u
      left join monitored_site_urls m
        on m.workspace_id = u.workspace_id and m.project_id = u.project_id
        and m.site_url_id = u.id and m.active
      -- The page's latest audit as the crawl shows it (SH-B9).
      left join lateral (${pageAuditsSql(crawl, sql.ref('u.id'))}) latest on true
      left join site_page_analyses a
        on a.workspace_id = u.workspace_id and a.id = latest.analysis_id
      left join lateral (
        select t.status, t.error_code from site_crawl_tasks t
        where t.workspace_id = u.workspace_id and t.crawl_id = ${crawl.id}
          and t.site_url_id = u.id and ${ROW_TASK}
        order by ${ROW_TASK_ORDER}, t.created_at desc limit 1
      ) t on true
      left join lateral (
        -- The formula the crawl's own link-metrics run wrote, not today's configuration.
        select * from site_page_link_metrics l
        where l.workspace_id = u.workspace_id and l.project_id = u.project_id
          and l.crawl_id = ${crawl.id} and l.site_url_id = u.id
          and l.extractor_version = ${crawl.extractor_version}
        order by l.created_at, l.formula_version limit 1
      ) l on true
      where u.workspace_id = ${crawl.workspace_id} and u.project_id = ${crawl.project_id}
        and exists (
          select 1 from site_url_observations o
          where o.workspace_id = u.workspace_id and o.site_url_id = u.id
            and o.crawl_id = any(${lineage}::uuid[]))
        ${filters.siteUrlId ? sql`and u.id = ${filters.siteUrlId}` : sql``}
        ${pattern ? sql`and (lower(u.normalized_url) like ${pattern} or lower(u.display_url) like ${pattern})` : sql``}
        ${filters.pageKind ? sql`and a.page_kind = ${filters.pageKind}` : sql``}
        ${
          filters.rule
            ? sql`and exists (
          select 1 from site_issues i
          where i.workspace_id = u.workspace_id and i.rule_id = ${filters.rule}
            and ${shownIssueFilter(crawl, 'i', 'a')})`
            : sql``
        }
        ${filters.monitored === true ? sql`and m.site_url_id is not null` : sql``}
        ${filters.monitored === false ? sql`and m.site_url_id is null` : sql``}
    ), windowed as (
      select * from keyed
      where true ${statusFilter(filters.status)} ${keyset}
      order by sort_value ${direction}, site_url_id ${direction}
      limit ${limit + 1}
    )
    select
      k.site_url_id,
      coalesce((
        select o.crawl_id from site_url_observations o
        where o.workspace_id = u.workspace_id and o.site_url_id = u.id
          and o.crawl_id = any(${lineage}::uuid[])
        order by array_position(${lineage}::uuid[], o.crawl_id) limit 1
      ), ${crawl.id}::uuid) as crawl_id,
      u.normalized_url,
      coalesce(nullif(u.display_url, ''), u.normalized_url) as display_url,
      nullif(u.latest_title, '') as title,
      nullif(u.latest_content_type, '') as content_type,
      nullif(u.latest_source_kind, '') as source,
      u.depth,
      u.first_seen_at,
      u.last_seen_at,
      k.monitored,
      k.analysis_id,
      k.analysis_status,
      k.error_code,
      a.page_kind,
      a.web_fundamentals_score,
      a.web_fundamentals_coverage,
      coalesce(a.web_fundamentals_state, 'not_measured') as web_fundamentals_state,
      a.aeo_readiness_score,
      a.aeo_measurement_coverage,
      coalesce(a.aeo_measurement_state, 'not_measured') as aeo_measurement_state,
      coalesce(a.aeo_measurement_reason, '') as aeo_measurement_reason,
      a.main_content_indexable,
      coalesce((
        select (f.acquisition_options ->> 'robots_excluded')::boolean
        from site_fetch_artifacts f
        where f.workspace_id = u.workspace_id and f.id = a.artifact_id
      ), false) as robots_excluded,
      a.finalized_at,
      case when a.id is null then null else (
        select count(*)::int from site_issues i
        where i.workspace_id = u.workspace_id and ${shownIssueFilter(crawl, 'i', 'a')}
      ) end as issue_count,
      k.inbound_count,
      k.main_content_inbound_count,
      k.depth_from_home,
      k.sort_value
    from windowed k
    join site_urls u on u.workspace_id = ${crawl.workspace_id} and u.id = k.site_url_id
    left join site_page_analyses a on a.workspace_id = u.workspace_id and a.id = k.analysis_id
    order by k.sort_value ${direction}, k.site_url_id ${direction}`.execute(db);
  return result.rows;
}

/**
 * The rule ids of each analysis's current issues, by finding class in rule
 * order: the same issues `issue_count` counts.
 */
export async function currentIssueRules(db: Database, crawl: Crawl, analysisIds: string[]) {
  const result = new Map<string, Record<string, string[]>>();
  if (!analysisIds.length) return result;
  const { rows } = await sql<{ analysis_id: string; finding_class: string; rule_id: string }>`
    select distinct a.id as analysis_id, i.finding_class, i.rule_id
    from site_page_analyses a
    join site_issues i on i.workspace_id = a.workspace_id and ${shownIssueFilter(crawl, 'i', 'a')}
    where a.workspace_id = ${crawl.workspace_id} and a.project_id = ${crawl.project_id}
      and a.id = any(${analysisIds}::uuid[])
    order by a.id, i.finding_class, i.rule_id`.execute(db);
  for (const row of rows) {
    const classes = result.get(row.analysis_id) ?? {};
    classes[row.finding_class] = [...(classes[row.finding_class] ?? []), row.rule_id];
    result.set(row.analysis_id, classes);
  }
  return result;
}

/** Each analysis's current evidence for one rule, keyed by analysis id. */
export async function currentRuleEvidence(
  db: Database,
  crawl: Crawl,
  analysisIds: string[],
  ruleId: string,
) {
  const result = new Map<string, unknown>();
  if (!analysisIds.length) return result;
  const { rows } = await sql<{ analysis_id: string; evidence: unknown }>`
    select distinct on (a.id) a.id as analysis_id, i.evidence
    from site_page_analyses a
    join site_issues i on i.workspace_id = a.workspace_id and ${shownIssueFilter(crawl, 'i', 'a')}
    where a.workspace_id = ${crawl.workspace_id} and a.project_id = ${crawl.project_id}
      and a.id = any(${analysisIds}::uuid[]) and i.rule_id = ${ruleId}
    order by a.id, i.created_at, i.id`.execute(db);
  for (const row of rows) result.set(row.analysis_id, row.evidence);
  return result;
}

export type Referrer = { site_url_id: string; url: string };

/**
 * The pages this crawl found linking to each URL, first sighting first: the
 * frontier's bounded referrer list, else the page that admitted the URL.
 */
export async function linkedFrom(db: Database, crawl: Crawl, siteUrlIds: string[]) {
  const result = new Map<string, Referrer[]>();
  if (!siteUrlIds.length) return result;
  const { rows } = await sql<{ site_url_id: string; referrer_id: string; url: string }>`
    select x.site_url_id, r.id as referrer_id,
      coalesce(nullif(r.display_url, ''), r.normalized_url) as url
    from (
      select u.id as site_url_id, f.referrer_site_url_ids as ids, 0 as source
      from site_urls u
      join site_discovery_frontier f
        on f.workspace_id = u.workspace_id and f.crawl_id = ${crawl.id} and f.url_hash = u.url_hash
      where u.workspace_id = ${crawl.workspace_id} and u.id = any(${siteUrlIds}::uuid[])
      union all
      select o.site_url_id, array[o.parent_site_url_id], 1
      from site_url_observations o
      where o.workspace_id = ${crawl.workspace_id} and o.crawl_id = ${crawl.id}
        and o.site_url_id = any(${siteUrlIds}::uuid[]) and o.parent_site_url_id is not null
    ) x
    cross join lateral unnest(x.ids) with ordinality as e(id, position)
    join site_urls r on r.id = e.id and r.workspace_id = ${crawl.workspace_id}
    order by x.site_url_id, x.source, e.position`.execute(db);
  for (const row of rows) {
    const referrers = result.get(row.site_url_id) ?? [];
    const known = referrers.some((referrer) => referrer.site_url_id === row.referrer_id);
    if (!known && referrers.length < MAX_REFERRERS)
      referrers.push({ site_url_id: row.referrer_id, url: row.url });
    result.set(row.site_url_id, referrers);
  }
  return result;
}

/** A page window's items and the cursor after its last row. */
export function pageWindow(
  rows: PageRow[],
  limit: number,
  scope: string,
  fingerprint: Record<string, unknown>,
) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next =
    rows.length > limit && last
      ? encodeKeysetCursor(scope, fingerprint, [String(last.sort_value), last.site_url_id])
      : null;
  return { items, next };
}

/** The `(sort value, id)` a page cursor resumes after; `InvalidCursorError` otherwise. */
export function pageCursor(
  cursor: string | null,
  scope: string,
  fingerprint: Record<string, unknown>,
  sort: PageSort,
) {
  if (!cursor) return null;
  const [value, raw, ...rest] = decodeKeysetCursor(cursor, scope, fingerprint);
  const id = parseUuid(raw);
  if (value === undefined || id === null || rest.length > 0)
    throw new InvalidCursorError('invalid cursor');
  if (SORTS[sort].kind === 'int' && !/^-?\d{1,10}$/u.test(value))
    throw new InvalidCursorError('invalid cursor');
  return { value, id };
}
