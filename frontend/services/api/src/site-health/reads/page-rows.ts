import { pageAnalysisStatusSchema } from '@citeladder/contracts/site-health';
import { sql, type RawBuilder } from 'kysely';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { parseUuid } from '../../http/uuid.ts';
import { failedAs } from '../task-outcome.ts';
import { inventoryCrawlIds, isTerminal, pageAuditsSql, type Crawl } from './crawl.ts';
import { ROW_TASK, ROW_TASK_ORDER } from './crawl-counters.ts';
import { pageFilterSql, type PageRowFilters } from './page-filters.ts';
import { siteLevelRuleOf } from './rules.ts';

const PERSISTED = ['completed', 'partially_completed'];
const DUPLICATE = policy.site_health.crawl.exclusions.duplicate;
const UNMEASURED_DEPTH = 2_147_483_647;
const MAX_REFERRERS = policy.site_health.crawl.max_referrers_per_url;

export const PAGE_SORTS = ['status', 'url', 'inbound', 'main_content_inbound', 'depth'] as const;
export type PageSort = (typeof PAGE_SORTS)[number];

type SortSpec = { value: RawBuilder<unknown>; kind: 'text' | 'int'; descending: boolean };

const SORTS: Record<PageSort, SortSpec> = {
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

export const PAGE_STATUS_FILTERS = [
  ...pageAnalysisStatusSchema.exclude(['failed']).options,
  'error_or_blocked',
] as const;

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
  web_checks_run: number | null;
  web_checks_total: number | null;
  aeo_checks_run: number | null;
  aeo_checks_total: number | null;
  main_content_indexable: boolean | null;
  robots_excluded: boolean;
  finalized_at: Date | null;
  issue_count: number | null;
  inbound_count: number | null;
  main_content_inbound_count: number | null;
  depth_from_home: number | null;
  sort_value: string | number;
};

export const aeoChecksSql = (
  dimensions: string,
  points: 'determinate_points' | 'expected_points',
) =>
  sql<number>`(select coalesce(sum((x ->> ${points})::numeric), 0)::int
    from jsonb_array_elements(case when jsonb_typeof(${sql.ref(dimensions)}) = 'array'
      then ${sql.ref(dimensions)} else '[]'::jsonb end) x
    where x ->> 'dimension_applicability' = 'applicable')`;

const checksRun = (run: number | null, total: number | null) =>
  run === null || total === null ? null : { run, total };

export const measurementFields = (row: PageRow) => ({
  page_kind: row.page_kind,
  web_fundamentals_score: row.web_fundamentals_score,
  web_fundamentals_coverage: row.web_fundamentals_coverage,
  web_fundamentals_state: row.web_fundamentals_state,
  aeo_readiness_score: row.aeo_readiness_score,
  aeo_measurement_coverage: row.aeo_measurement_coverage,
  aeo_measurement_state: row.aeo_measurement_state,
  aeo_measurement_reason: row.aeo_measurement_reason,
  web_fundamentals_checks: checksRun(row.web_checks_run, row.web_checks_total),
  aeo_readiness_checks: checksRun(row.aeo_checks_run, row.aeo_checks_total),
  main_content_indexable: row.main_content_indexable,
  robots_excluded: row.robots_excluded,
  last_audited: row.finalized_at?.toISOString() ?? null,
  issue_count: row.issue_count,
});

export function currentIssueFilter(issue: string, analysis: string) {
  const evaluation = sql.ref(issue + '.evaluation_id');
  const sources = sql.ref(analysis + '.source_evaluation_ids');
  const issueAnalysis = sql.ref(issue + '.analysis_id');
  const analysisId = sql.ref(analysis + '.id');
  return sql`(${evaluation} = any(${sources})
    or (${issueAnalysis} = ${analysisId} and exists(
      select 1 from site_rule_evaluations e
      where e.id = ${evaluation} and e.analysis_id = ${issueAnalysis}
        and e.source_architecture_id is not null)))`;
}

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

function latestAuditsJoin(crawl: Crawl, siteUrlId?: string) {
  return siteUrlId
    ? sql`left join lateral (${pageAuditsSql(crawl, sql.ref('u.id'))}) latest on true`
    : sql`left join (${pageAuditsSql(crawl)}) latest on latest.site_url_id = u.id`;
}

function pageSet(trackedOnly: boolean) {
  return trackedOnly
    ? sql`from monitored_site_urls m
      join site_urls u on u.workspace_id = m.workspace_id and u.project_id = m.project_id
        and u.id = m.site_url_id and m.active`
    : sql`from site_urls u
      left join monitored_site_urls m
        on m.workspace_id = u.workspace_id and m.project_id = u.project_id
        and m.site_url_id = u.id and m.active`;
}

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
  let keyset = sql``;
  if (after) {
    const value =
      spec.kind === 'int' ? sql`${Number(after.value)}::int` : sql`${after.value}::text`;
    keyset = spec.descending
      ? sql`and (sort_value, site_url_id) < (${value}, ${after.id}::uuid)`
      : sql`and (sort_value, site_url_id) > (${value}, ${after.id}::uuid)`;
  }
  const direction = sql.raw(spec.descending ? 'desc' : 'asc');
  const duplicate = sql`(k.analysis_id is null and k.error_code = ${DUPLICATE})`;
  const unmeasured = sql`case when ${duplicate} then 'excluded' else 'not_measured' end`;
  const latestAudits = latestAuditsJoin(crawl, filters.siteUrlId);
  const onePage = (column: string) =>
    filters.siteUrlId ? sql`and ${sql.ref(column)} = ${filters.siteUrlId}::uuid` : sql``;
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
          -- Finalization retired the analysis of a canonical alias: settled, never pending.
          when t.status = 'succeeded' and u.disposition_reason = ${DUPLICATE} then 'not_measured'
          when t.status = 'failed' then
            case when ${failedAs('t', ['blocked', 'excluded'])}
              then 'blocked' else 'error' end
          when t.status in ('running', 'leased') then 'running'
          else 'pending'
        end as analysis_status,
        case
          when a.status = any(${PERSISTED}::text[]) then ''
          when t.status in ('cancelled', 'failed') then coalesce(t.error_code, '')
          when t.status = 'succeeded' and u.disposition_reason = ${DUPLICATE} then u.disposition_reason
          else ''
        end as error_code,
        l.inbound_count,
        l.main_content_inbound_count,
        l.depth_from_home,
        ${spec.value} as sort_value
      ${pageSet(filters.monitored === true)}
      -- The page's latest audit as the crawl shows it (SH-B9).
      ${latestAudits}
      left join site_page_analyses a
        on a.workspace_id = u.workspace_id and a.id = latest.analysis_id
      -- The crawl's tasks and link metrics join as sets, never probed per URL.
      left join (
        select distinct on (t.site_url_id) t.site_url_id, t.status, t.error_code
        from site_crawl_tasks t
        where t.workspace_id = ${crawl.workspace_id} and t.crawl_id = ${crawl.id}
          and t.site_url_id is not null and ${ROW_TASK} ${onePage('t.site_url_id')}
        order by t.site_url_id, ${ROW_TASK_ORDER}, t.created_at desc
      ) t on t.site_url_id = u.id
      left join (
        -- The formula the crawl's own link-metrics run wrote, not today's configuration.
        select distinct on (l.site_url_id) l.site_url_id, l.inbound_count,
          l.main_content_inbound_count, l.depth_from_home
        from site_page_link_metrics l
        where l.workspace_id = ${crawl.workspace_id} and l.project_id = ${crawl.project_id}
          and l.crawl_id = ${crawl.id} and l.extractor_version = ${crawl.extractor_version}
          ${onePage('l.site_url_id')}
        order by l.site_url_id, l.created_at, l.formula_version
      ) l on l.site_url_id = u.id
      where u.workspace_id = ${crawl.workspace_id} and u.project_id = ${crawl.project_id}
        and exists (
          select 1 from site_url_observations o
          where o.workspace_id = u.workspace_id and o.site_url_id = u.id
            and o.crawl_id = any(${lineage}::uuid[]))
        ${pageFilterSql(filters, shownIssueFilter(crawl, 'i', 'a'))}
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
      coalesce(a.web_fundamentals_state, ${unmeasured}) as web_fundamentals_state,
      a.aeo_readiness_score,
      a.aeo_measurement_coverage,
      coalesce(a.aeo_measurement_state, ${unmeasured}) as aeo_measurement_state,
      coalesce(a.aeo_measurement_reason, case when ${duplicate} then k.error_code else '' end)
        as aeo_measurement_reason,
      a.technical_determinate_weight::int as web_checks_run,
      a.technical_expected_weight::int as web_checks_total,
      case when a.id is null then null else ${aeoChecksSql('a.readiness_dimensions', 'determinate_points')} end
        as aeo_checks_run,
      case when a.id is null then null else ${aeoChecksSql('a.readiness_dimensions', 'expected_points')} end
        as aeo_checks_total,
      a.main_content_indexable,
      coalesce((
        select (f.acquisition_options ->> 'robots_excluded')::boolean
        from site_fetch_artifacts f
        where f.workspace_id = u.workspace_id and f.crawl_id = a.crawl_id and f.id = a.artifact_id
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

export async function currentIssueRules(db: Database, crawl: Crawl, analysisIds: string[]) {
  const result = new Map<string, string[]>();
  if (!analysisIds.length) return result;
  const { rows } = await sql<{ analysis_id: string; rule_id: string }>`
    select distinct a.id as analysis_id, i.rule_id
    from site_page_analyses a
    join site_issues i on i.workspace_id = a.workspace_id and ${shownIssueFilter(crawl, 'i', 'a')}
    where a.workspace_id = ${crawl.workspace_id} and a.project_id = ${crawl.project_id}
      and a.id = any(${analysisIds}::uuid[])
    order by a.id, i.rule_id`.execute(db);
  for (const row of rows)
    result.set(row.analysis_id, [...(result.get(row.analysis_id) ?? []), row.rule_id]);
  return result;
}

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
