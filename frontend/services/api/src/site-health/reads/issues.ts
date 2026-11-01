/**
 * The grouped issue catalog, one group's occurrences, and a URL's issue history.
 *
 * A crawl's issues are those of its current, finalized page analyses. Groups
 * are `(rule, finding class)` within the crawl, identified by a stable UUID;
 * the summary counts groups rather than occurrences, so its tiles match the
 * list.
 */
import {
  issueHistoryPageSchema,
  siteIssueDetailSchema,
  siteIssuesPageSchema,
} from '@citeladder/contracts/site-health';
import { sql, type RawBuilder } from 'kysely';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { storedInstant, utcTextOf } from '../../db/timestamps.ts';
import { notFound } from '../../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { containsPattern } from '../../db/like.ts';
import { parseUuid } from '../../http/uuid.ts';
import { firstOf } from '../../lists.ts';
import { compareText } from '../../text-order.ts';
import { loadCrawl, type Crawl } from './crawl.ts';
import { requireAdmitted } from './pages.ts';
import {
  issueGroupId,
  issueOccurrence,
  remediationRoute,
  rulesTitled,
  ruleTitle,
  severityRank,
  siteLevelScope,
  type IssueRow,
} from './rules.ts';

const reads = policy.site_health.reads;
type Paging = { limit: number; cursor: string | null };

export type IssueFilters = {
  query: string | null;
  severity: string | null;
  category: string | null;
  dimension: string | null;
  rule: string | null;
  siteUrlId: string | null;
  pageKind: string | null;
  findingClass: string;
};

/**
 * Evaluation ids of the crawl's current, finalized analyses (optionally one
 * page kind), plus its site-level architecture evaluations, which the
 * snapshot's issue counts include.
 */
function currentEvaluations(crawl: Crawl, pageKind: string | null = null) {
  const kindFilter = pageKind ? sql`and a.page_kind = ${pageKind}` : sql``;
  const architecture = pageKind
    ? sql``
    : sql`union all
  select e.id from site_rule_evaluations e
  join site_observed_architectures o
    on o.id = e.source_architecture_id and o.workspace_id = e.workspace_id
  where o.workspace_id = ${crawl.workspace_id} and o.crawl_id = ${crawl.id}`;
  return sql`(
  select unnest(a.source_evaluation_ids) from site_page_analyses a
  where a.workspace_id = ${crawl.workspace_id} and a.crawl_id = ${crawl.id}
    and a.is_current and a.finalized_at is not null
    ${kindFilter}
  ${architecture})`;
}

/** Issues of the crawl's current analyses. */
const currentIssues = (crawl: Crawl) =>
  sql`i.workspace_id = ${crawl.workspace_id} and i.crawl_id = ${crawl.id}
    and i.evaluation_id in ${currentEvaluations(crawl)}`;

function issueWhere(
  crawl: Crawl,
  filters: Omit<IssueFilters, 'findingClass'> & { findingClass: string | null },
): RawBuilder<unknown> {
  const clauses = [currentIssues(crawl)];
  // The catalog shows three tiers; `high` includes `critical`.
  if (filters.severity === 'high') clauses.push(sql`i.severity in ('high', 'critical')`);
  else if (filters.severity) clauses.push(sql`i.severity = ${filters.severity}`);
  if (filters.category) clauses.push(sql`i.category = ${filters.category}`);
  if (filters.dimension) clauses.push(sql`i.dimension = ${filters.dimension}`);
  if (filters.rule) clauses.push(sql`i.rule_id = ${filters.rule}`);
  if (filters.siteUrlId) clauses.push(sql`i.site_url_id = ${filters.siteUrlId}`);
  if (filters.pageKind)
    clauses.push(sql`i.evaluation_id in ${currentEvaluations(crawl, filters.pageKind)}`);
  if (filters.findingClass) clauses.push(sql`i.finding_class = ${filters.findingClass}`);
  if (filters.query) {
    // The reader searches the titles they see ("broken internal links"), not rule ids.
    const query = filters.query.trim();
    clauses.push(
      sql`(i.rule_id ilike ${containsPattern(query)} or i.rule_id = any(${rulesTitled(query)}::text[]))`,
    );
  }
  return sql.join(clauses, sql` and `);
}

type Group = IssueRow & { affected_url_count: number; group_id: string };

/** Matching rule groups, each with its earliest current occurrence as the representative. */
async function issueGroups(db: Database, crawl: Crawl, filters: IssueFilters): Promise<Group[]> {
  const { rows } = await sql<IssueRow & { affected_url_count: number }>`
    with matching as (
      select i.rule_id, count(distinct i.site_url_id)::int as affected_url_count
      from site_issues i where ${issueWhere(crawl, filters)} group by i.rule_id
    )
    select distinct on (i.rule_id) i.*, '' as reason_code, m.affected_url_count
    from site_issues i join matching m on m.rule_id = i.rule_id
    where ${currentIssues(crawl)} and i.finding_class = ${filters.findingClass}
    order by i.rule_id, i.created_at, i.id`.execute(db);
  return rows
    .map((row) => ({
      ...row,
      affected_url_count:
        siteLevelScope(row.rule_id, row.evidence)?.affected ?? row.affected_url_count,
      group_id: issueGroupId(crawl.id, row.rule_id, filters.findingClass),
    }))
    .sort(compareGroups);
}

/** Worst first; within a severity, the issue on the most pages first. */
type GroupKey = readonly [rank: number, affected: number, rule: string, group: string];
const groupKey = (group: Group): GroupKey =>
  [severityRank(group.severity), group.affected_url_count, group.rule_id, group.group_id] as const;

function compareKeys(a: GroupKey, b: GroupKey) {
  return a[0] - b[0] || b[1] - a[1] || compareText(a[2], b[2]) || compareText(a[3], b[3]);
}
const compareGroups = (a: Group, b: Group) => compareKeys(groupKey(a), groupKey(b));

/** Group counts for the tiles and chips: severity and dimension chips never narrow them. */
async function issueSummary(db: Database, crawl: Crawl, filters: IssueFilters) {
  const unchipped = { ...filters, severity: null, dimension: null };
  const scoped = issueWhere(crawl, unchipped);
  const anyClass = issueWhere(crawl, { ...unchipped, findingClass: null });
  const [classes, severities, dimensions, totals] = await Promise.all([
    sql<{ finding_class: string; count: number }>`
      select i.finding_class, count(distinct i.rule_id)::int as count
      from site_issues i where ${anyClass} group by i.finding_class`.execute(db),
    sql<{ severity: string; count: number }>`
      select i.severity, count(distinct i.rule_id)::int as count
      from site_issues i where ${anyClass} and i.finding_class = 'defect'
      group by i.severity`.execute(db),
    sql<{ dimension: string; count: number }>`
      select i.dimension, count(distinct i.rule_id)::int as count
      from site_issues i where ${scoped} group by i.dimension`.execute(db),
    sql<{ affected: number; occurrences: number; monitored: number }>`
      select count(distinct i.site_url_id)::int as affected, count(*)::int as occurrences,
        count(distinct i.site_url_id) filter (where exists (
          select 1 from monitored_site_urls m
          where m.workspace_id = i.workspace_id and m.site_url_id = i.site_url_id and m.active
        ))::int as monitored
      from site_issues i where ${scoped}`.execute(db),
  ]);
  const byClass = Object.fromEntries(classes.rows.map((row) => [row.finding_class, row.count]));
  const severityCounts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  // `critical` folds into `high`, matching the High filter's rows.
  for (const row of severities.rows) {
    const key = row.severity === 'critical' ? 'high' : row.severity;
    severityCounts[key] = (severityCounts[key] ?? 0) + row.count;
  }
  const dimensionCounts: Record<string, number> = Object.fromEntries(
    reads.rule_dimensions.map((name) => [name, 0]),
  );
  for (const row of dimensions.rows) dimensionCounts[row.dimension] = row.count;
  const total = firstOf(totals.rows, 'the issue totals');
  return {
    issue_count: byClass.defect ?? 0,
    defect_issue_type_count: byClass.defect ?? 0,
    advisory_issue_type_count: byClass.advisory ?? 0,
    occurrence_count: total.occurrences,
    severity_counts: severityCounts,
    dimension_counts: dimensionCounts,
    affected_url_count: total.affected,
    monitored_affected_url_count: total.monitored,
  };
}

/** The distinct classified page kinds each rule's affected pages carry. */
export async function pageKindsByRule(
  db: Database,
  crawl: Crawl,
  ruleIds: string[] | null,
  findingClass: string | null,
) {
  if (ruleIds?.length === 0) return new Map<string, string[]>();
  const { rows } = await sql<{ rule_id: string; kinds: string[] }>`
    select i.rule_id, array_agg(distinct a.page_kind order by a.page_kind)
      filter (where a.page_kind is not null and a.page_kind <> '') as kinds
    from site_issues i
    join site_page_analyses a on a.workspace_id = i.workspace_id and a.crawl_id = i.crawl_id
      and a.site_url_id = i.site_url_id and a.is_current
    where ${currentIssues(crawl)}
      ${ruleIds ? sql`and i.rule_id = any(${ruleIds}::text[])` : sql``}
      ${findingClass ? sql`and i.finding_class = ${findingClass}` : sql``}
    group by i.rule_id`.execute(db);
  return new Map(rows.map((row) => [row.rule_id, row.kinds ?? []]));
}

function groupCursor(cursor: string | null, fingerprint: Record<string, unknown>) {
  if (!cursor) return null;
  const [rank, affected, rule, id, ...rest] = decodeKeysetCursor(cursor, 'issues', fingerprint);
  if (
    rank === undefined ||
    affected === undefined ||
    rule === undefined ||
    id === undefined ||
    rest.length > 0
  )
    throw new InvalidCursorError('invalid cursor');
  if (!/^\d{1,3}$/u.test(rank) || !/^\d{1,9}$/u.test(affected))
    throw new InvalidCursorError('invalid cursor');
  return [Number(rank), Number(affected), rule, id] as const;
}

export async function issues(
  db: Database,
  workspaceId: string,
  crawlId: string,
  filters: IssueFilters,
  paging: Paging,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const fingerprint = {
    crawl_id: crawl.id,
    query: filters.query?.trim() || null,
    severity: filters.severity,
    category: filters.category,
    dimension: filters.dimension,
    rule: filters.rule,
    site_url_id: filters.siteUrlId,
    page_kind: filters.pageKind,
    finding_class: filters.findingClass,
  };
  const after = groupCursor(paging.cursor, fingerprint);
  const groups = await issueGroups(db, crawl, filters);
  const start = after ? groups.findIndex((group) => compareKeys(groupKey(group), after) > 0) : 0;
  const window = start < 0 ? [] : groups.slice(start, start + paging.limit + 1);
  const items = window.slice(0, paging.limit);
  const last = items.at(-1);
  const [kinds, summary] = await Promise.all([
    pageKindsByRule(
      db,
      crawl,
      items.map((group) => group.rule_id),
      filters.findingClass,
    ),
    issueSummary(db, crawl, filters),
  ]);
  return siteIssuesPageSchema.parse({
    items: items.map((group) => ({
      group_id: group.group_id,
      crawl_id: crawl.id,
      rule_id: group.rule_id,
      page_kinds:
        siteLevelScope(group.rule_id, group.evidence)?.pageKinds ?? kinds.get(group.rule_id) ?? [],
      dimension: group.dimension,
      category: group.category,
      severity: group.severity,
      finding_class: group.finding_class,
      title: ruleTitle(group.rule_id),
      description: group.description,
      remediation: group.remediation,
      remediation_route: remediationRoute(group.rule_id),
      affected_url_count: group.affected_url_count,
      analyzer_version: group.analyzer_version,
      rule_version: group.rule_version,
      created_at: group.created_at.toISOString(),
    })),
    next_cursor:
      window.length > paging.limit && last
        ? encodeKeysetCursor('issues', fingerprint, groupKey(last).map(String))
        : null,
    summary,
  });
}

export async function issueDetail(
  db: Database,
  workspaceId: string,
  crawlId: string,
  groupId: string,
  paging: Paging,
  siteUrlId?: string,
  /** The catalog's page-kind filter: the rail lists the pages the list row counted. */
  pageKind: string | null = null,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const candidates = await sql<{ rule_id: string; finding_class: string }>`
    select distinct i.rule_id, i.finding_class from site_issues i
    where ${currentIssues(crawl)}`.execute(db);
  const group = candidates.rows.find(
    (row) => issueGroupId(crawl.id, row.rule_id, row.finding_class) === groupId,
  );
  if (group === undefined) throw notFound('Issue');
  const kindFilter = pageKind
    ? sql`and i.evaluation_id in ${currentEvaluations(crawl, pageKind)}`
    : sql``;
  const inGroup = sql`${currentIssues(crawl)} and i.rule_id = ${group.rule_id}
    and i.finding_class = ${group.finding_class} ${kindFilter}`;
  const fingerprint = {
    crawl_id: crawl.id,
    group_id: groupId,
    site_url_id: siteUrlId ?? null,
    page_kind: pageKind,
  };
  let after = sql``;
  if (paging.cursor) {
    const [url, raw, ...rest] = decodeKeysetCursor(paging.cursor, 'issue_detail', fingerprint);
    const id = parseUuid(raw);
    if (url === undefined || id === null || rest.length > 0)
      throw new InvalidCursorError('invalid cursor');
    after = sql`and (u.normalized_url, i.id) > (${url}, ${id}::uuid)`;
  }
  const [canonical, totals, occurrences] = await Promise.all([
    sql<IssueRow>`select i.*, '' as reason_code from site_issues i where ${inGroup}
      order by i.created_at, i.id limit 1`.execute(db),
    sql<{ affected: number; occurrences: number }>`
      select count(distinct i.site_url_id)::int as affected, count(*)::int as occurrences
      from site_issues i where ${inGroup}`.execute(db),
    sql<
      IssueRow & {
        site_url_id: string;
        normalized_url: string;
        display_url: string;
        title: string | null;
        page_kind: string | null;
      }
    >`
      select i.*, u.normalized_url, u.display_url, u.latest_title as title,
        a.page_kind, e.reason_code
      from site_issues i
      join site_urls u on u.id = i.site_url_id
      join site_page_analyses a on a.workspace_id = i.workspace_id and a.crawl_id = i.crawl_id
        and a.site_url_id = i.site_url_id and a.is_current
      join site_rule_evaluations e on e.id = i.evaluation_id
      where ${inGroup} ${after} ${siteUrlId ? sql`and i.site_url_id = ${siteUrlId}::uuid` : sql``}
      order by u.normalized_url, i.id limit ${paging.limit + 1}`.execute(db),
  ]);
  const representative = canonical.rows[0];
  if (representative === undefined) throw notFound('Issue');
  const page = occurrences.rows.slice(0, paging.limit);
  const last = page.at(-1);
  const total = firstOf(totals.rows, 'the issue group totals');
  return siteIssueDetailSchema.parse({
    group_id: groupId,
    crawl_id: crawl.id,
    rule_id: representative.rule_id,
    dimension: representative.dimension,
    category: representative.category,
    severity: representative.severity,
    finding_class: representative.finding_class,
    title: ruleTitle(representative.rule_id),
    description: representative.description,
    remediation: representative.remediation,
    remediation_route: remediationRoute(representative.rule_id),
    occurrences: page.map((row) => issueOccurrence(row, row)),
    occurrence_count: total.occurrences,
    affected_url_count:
      siteLevelScope(representative.rule_id, representative.evidence)?.affected ?? total.affected,
    analyzer_version: representative.analyzer_version,
    rule_version: representative.rule_version,
    created_at: representative.created_at.toISOString(),
    next_cursor:
      occurrences.rows.length > paging.limit && last
        ? encodeKeysetCursor('issue_detail', fingerprint, [last.normalized_url, last.id])
        : null,
  });
}

/**
 * A URL's resolved issues: rules found on it in the selected crawl's superseded
 * analyses or the project's earlier crawls that its current, finalized
 * analysis no longer reports. One row per rule, its latest record, newest
 * first. Current open issues never appear (they are the page detail), nor does
 * a later crawl's record on an older crawl; without a finalized current
 * analysis nothing is known to be resolved.
 */
export async function issueHistory(
  db: Database,
  workspaceId: string,
  crawlId: string,
  siteUrlId: string,
  paging: Paging,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  await requireAdmitted(db, crawl, siteUrlId);
  const finalized = await db
    .selectFrom('site_page_analyses')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('crawl_id', '=', crawl.id)
    .where('site_url_id', '=', siteUrlId)
    .where('is_current', '=', true)
    .where('finalized_at', 'is not', null)
    .executeTakeFirst();
  if (!finalized)
    return issueHistoryPageSchema.parse({
      items: [],
      next_cursor: null,
      current_analysis_finalized: false,
    });
  const fingerprint = { site_url_id: siteUrlId, project_id: crawl.project_id, crawl_id: crawl.id };
  let after = sql``;
  if (paging.cursor) {
    const [created, raw, ...rest] = decodeKeysetCursor(paging.cursor, 'issue_history', fingerprint);
    const id = parseUuid(raw);
    if (!created || !/^\d{4}-\d{2}-\d{2}T[\d:.]+$/u.test(created) || id === null || rest.length)
      throw new InvalidCursorError('invalid cursor');
    after = sql`and (r.created_at, r.id) < (${storedInstant(created)}, ${id}::uuid)`;
  }
  const { rows } = await sql<IssueRow & { created_text: string }>`
    with resolved as (
      select distinct on (i.rule_id) i.*
      from site_issues i
      join site_crawls c on c.id = i.crawl_id
      join site_crawls selected on selected.id = ${crawl.id}
      -- The page's one current, finalized analysis in the selected crawl.
      join site_page_analyses cur on cur.id = ${finalized.id}
      where i.workspace_id = ${workspaceId} and i.project_id = ${crawl.project_id}
        and i.site_url_id = ${siteUrlId} and c.project_id = ${crawl.project_id}
        and (c.created_at, c.id) <= (selected.created_at, selected.id)
        and not exists (
          select 1 from site_issues still_open
          where still_open.workspace_id = ${workspaceId} and still_open.crawl_id = ${crawl.id}
            and still_open.evaluation_id = any(cur.source_evaluation_ids)
            and still_open.site_url_id = ${siteUrlId} and still_open.rule_id = i.rule_id)
      order by i.rule_id, i.created_at desc, i.id desc
    )
    select r.*, ${utcTextOf(sql.ref('r.created_at'))} as created_text
    from resolved r
    where true ${after}
    order by r.created_at desc, r.id desc limit ${paging.limit + 1}`.execute(db);
  const items = rows.slice(0, paging.limit);
  const last = items.at(-1);
  return issueHistoryPageSchema.parse({
    current_analysis_finalized: true,
    items: items.map((issue) => ({
      id: issue.id,
      crawl_id: issue.crawl_id,
      rule_id: issue.rule_id,
      dimension: issue.dimension,
      category: issue.category,
      severity: issue.severity,
      finding_class: issue.finding_class,
      title: ruleTitle(issue.rule_id),
      description: issue.description,
      remediation: issue.remediation,
      analyzer_version: issue.analyzer_version,
      rule_version: issue.rule_version,
      created_at: issue.created_at.toISOString(),
    })),
    next_cursor:
      rows.length > paging.limit && last
        ? encodeKeysetCursor('issue_history', fingerprint, [last.created_text, last.id])
        : null,
  });
}
