import {
  siteIssueDetailSchema,
  siteIssuesPageSchema,
  type IssueSection,
  type IssueSort,
} from '@citeladder/contracts/site-health';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { containsPattern } from '../../db/like.ts';
import { parseUuid } from '../../http/uuid.ts';
import { firstOf } from '../../lists.ts';
import { loadCrawl, viewIssuesSql, type Crawl } from './crawl.ts';
import { issueChanges } from './issue-changes.ts';
import { issueValue } from './issue-values.ts';
import { decodeGroupCursor, groupCursorAfter, groupOrder, resumeIndex } from './issue-order.ts';
import {
  issueGroupId,
  issueOccurrence,
  issueSection,
  remediationRoute,
  ruleScoreRoles,
  rulesTitled,
  ruleTitle,
  siteLevelRule,
  siteLevelScope,
  type IssueRow,
} from './rules.ts';

const reads = policy.site_health.reads;
export type Paging = { limit: number; cursor: string | null };

export type IssueFilters = {
  query: string | null;
  severity: string | null;
  category: string | null;
  dimension: string | null;
  rule: string | null;
  siteUrlId: string | null;
  pageKind: string | null;
};

function ofPageKind(crawl: Crawl, pageKind: string) {
  return sql`(case when ${siteLevelRule}
    then coalesce(i.evidence -> 'page_kind_counts' ? ${pageKind}, false)
    else ${onPageOfKind(crawl, pageKind, sql`and i.evaluation_id = any(a.source_evaluation_ids)`)}
    end)`;
}

function onPageOfKind(crawl: Crawl, pageKind: string, also = sql``) {
  return sql`exists (
    select 1 from site_page_analyses a
    where a.workspace_id = ${crawl.workspace_id} and a.crawl_id = i.crawl_id
      and a.site_url_id = i.site_url_id and a.is_current and a.finalized_at is not null
      and a.page_kind = ${pageKind} ${also})`;
}

const currentIssues = (crawl: Crawl) => viewIssuesSql(crawl);

function issueWhere(crawl: Crawl, filters: IssueFilters): RawBuilder<unknown> {
  const clauses = [currentIssues(crawl)];
  if (filters.severity === 'high') clauses.push(sql`i.severity in ('high', 'critical')`);
  else if (filters.severity) clauses.push(sql`i.severity = ${filters.severity}`);
  if (filters.category) clauses.push(sql`i.category = ${filters.category}`);
  if (filters.dimension) clauses.push(sql`i.dimension = ${filters.dimension}`);
  if (filters.rule) clauses.push(sql`i.rule_id = ${filters.rule}`);
  if (filters.siteUrlId) clauses.push(sql`i.site_url_id = ${filters.siteUrlId}`);
  if (filters.pageKind) clauses.push(ofPageKind(crawl, filters.pageKind));
  if (filters.query) {
    const query = filters.query.trim();
    clauses.push(
      sql`(i.rule_id ilike ${containsPattern(query)} or i.rule_id = any(${rulesTitled(query)}::text[]))`,
    );
  }
  return sql.join(clauses, sql` and `);
}

type Group = IssueRow & { affected_url_count: number; group_id: string };
type IssueItem = z.infer<typeof siteIssuesPageSchema>['items'][number];
export type IssueSummary = Omit<z.input<typeof siteIssuesPageSchema>['summary'], 'section_counts'>;

export const unfilteredIssues = (): IssueFilters => ({
  query: null,
  severity: null,
  category: null,
  dimension: null,
  rule: null,
  siteUrlId: null,
  pageKind: null,
});

const isUnfiltered = (filters: IssueFilters) =>
  !filters.query?.trim() &&
  !filters.severity &&
  !filters.category &&
  !filters.dimension &&
  !filters.rule &&
  !filters.siteUrlId &&
  !filters.pageKind;

async function issueGroups(db: Database, crawl: Crawl, filters: IssueFilters): Promise<Group[]> {
  const { rows } = await sql<IssueRow & { affected_url_count: number }>`
    with matching as (
      select i.rule_id, count(distinct i.site_url_id)::int as affected_url_count
      from site_issues i where ${issueWhere(crawl, filters)} group by i.rule_id
    )
    select distinct on (i.rule_id) i.*, '' as reason_code, m.affected_url_count
    from site_issues i
    join matching m on m.rule_id = i.rule_id
    where ${currentIssues(crawl)}
    order by i.rule_id, i.created_at, i.id`.execute(db);
  return rows
    .map((row) => ({
      ...row,
      affected_url_count:
        siteLevelScope(row.rule_id, row.evidence, filters.pageKind)?.affected ??
        row.affected_url_count,
      group_id: issueGroupId(crawl.id, row.rule_id),
    }))
    .sort(compareGroups);
}

const compareGroups = groupOrder('severity');

export type IssueView = { section: IssueSection | null; sort: IssueSort };
const ALL_SECTIONS_BY_SEVERITY: IssueView = { section: null, sort: 'severity' };

function sectionCounts(groups: readonly Pick<IssueItem, 'dimension' | 'category'>[]) {
  const counts: Record<IssueSection, number> = { technical: 0, content: 0, aeo: 0 };
  for (const group of groups) counts[issueSection(group)] += 1;
  return counts;
}

function summaryScope(crawl: Crawl, filters: IssueFilters) {
  const unchipped = { ...filters, severity: null, dimension: null };
  return {
    scoped: issueWhere(crawl, unchipped),
    countedPage: filters.pageKind
      ? sql`not ${siteLevelRule} or ${onPageOfKind(crawl, filters.pageKind)}`
      : sql`true`,
  };
}

export async function issueSummary(
  db: Database,
  crawl: Crawl,
  filters: IssueFilters,
): Promise<IssueSummary> {
  const { scoped, countedPage } = summaryScope(crawl, filters);
  const [types, severities, dimensions, totals, siteLevel, monitored] = await Promise.all([
    sql<{ count: number }>`
      select count(distinct i.rule_id)::int as count
      from site_issues i where ${scoped}`.execute(db),
    sql<{ severity: string; count: number }>`
      select i.severity, count(distinct i.rule_id)::int as count
      from site_issues i where ${scoped}
      group by i.severity`.execute(db),
    sql<{ dimension: string; count: number }>`
      select i.dimension, count(distinct i.rule_id)::int as count
      from site_issues i where ${scoped} group by i.dimension`.execute(db),
    sql<{ affected: number; occurrences: number }>`
      select count(distinct i.site_url_id) filter (where ${countedPage})::int as affected,
        count(*)::int as occurrences
      from site_issues i where ${scoped}`.execute(db),
    sql<{ rule_id: string; evidence: unknown }>`
      select i.rule_id, i.evidence from site_issues i
      where ${scoped} and ${siteLevelRule}`.execute(db),
    sql<{ monitored: number }>`
      select count(distinct i.site_url_id) filter (where (${countedPage}) and i.site_url_id in (
        select m.site_url_id from monitored_site_urls m
        where m.workspace_id = ${crawl.workspace_id} and m.project_id = ${crawl.project_id}
          and m.active))::int as monitored
      from site_issues i where ${scoped}`.execute(db),
  ]);
  const severityCounts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const row of severities.rows) {
    const key = row.severity === 'critical' ? 'high' : row.severity;
    severityCounts[key] = (severityCounts[key] ?? 0) + row.count;
  }
  const dimensionCounts: Record<string, number> = Object.fromEntries(
    reads.rule_dimensions.map((name) => [name, 0]),
  );
  for (const row of dimensions.rows) dimensionCounts[row.dimension] = row.count;
  const total = firstOf(totals.rows, 'the issue totals');
  const siteLevelAffected = Math.max(
    0,
    ...siteLevel.rows.map(
      (row) => siteLevelScope(row.rule_id, row.evidence, filters.pageKind)?.affected ?? 0,
    ),
  );
  return {
    issue_count: firstOf(types.rows, 'the issue type count').count,
    occurrence_count: total.occurrences,
    severity_counts: severityCounts,
    dimension_counts: dimensionCounts,
    affected_url_count: Math.max(total.affected, siteLevelAffected),
    monitored_affected_url_count: firstOf(monitored.rows, 'the monitored affected count').monitored,
  };
}

async function pageKindsByRule(db: Database, crawl: Crawl, ruleIds: string[] | null) {
  if (ruleIds?.length === 0) return new Map<string, string[]>();
  const { rows } = await sql<{ rule_id: string; kinds: string[] }>`
    select i.rule_id, array_agg(distinct a.page_kind order by a.page_kind)
      filter (where a.page_kind is not null and a.page_kind <> '') as kinds
    from site_issues i
    join site_page_analyses a on a.workspace_id = i.workspace_id and a.crawl_id = i.crawl_id
      and a.site_url_id = i.site_url_id and a.is_current
    where ${currentIssues(crawl)}
      ${ruleIds ? sql`and i.rule_id = any(${ruleIds}::text[])` : sql``}
    group by i.rule_id`.execute(db);
  return new Map(rows.map((row) => [row.rule_id, row.kinds ?? []]));
}

export async function issues(
  db: Database,
  workspaceId: string,
  crawlId: string,
  filters: IssueFilters,
  paging: Paging,
  view: IssueView = ALL_SECTIONS_BY_SEVERITY,
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
    section: view.section,
    sort: view.sort,
  };
  const after = decodeGroupCursor(paging.cursor, fingerprint);
  const catalog = isUnfiltered(filters) ? await persistedCatalog(db, crawl) : null;
  const [listed, summary] = await Promise.all([
    catalog?.items ?? catalogItems(db, crawl, filters),
    catalog?.summary ?? issueSummary(db, crawl, filters),
  ]);
  const ranked = listed
    .filter((group) => view.section === null || issueSection(group) === view.section)
    .sort(groupOrder(view.sort));
  const start = resumeIndex(ranked, view.sort, after);
  const window = start < 0 ? [] : ranked.slice(start, start + paging.limit + 1);
  const items = window.slice(0, paging.limit);
  const last = items.at(-1);
  return siteIssuesPageSchema.parse({
    items,
    next_cursor: window.length > paging.limit && last ? groupCursorAfter(fingerprint, last) : null,
    summary: { ...summary, section_counts: sectionCounts(listed) },
  });
}

export async function catalogItems(
  db: Database,
  crawl: Crawl,
  filters: IssueFilters,
): Promise<IssueItem[]> {
  const groups = await issueGroups(db, crawl, filters);
  const [kinds, changeOf] = await Promise.all([
    pageKindsByRule(
      db,
      crawl,
      groups.map((group) => group.rule_id),
    ),
    issueChanges(db, crawl, {
      matching: issueWhere(crawl, filters),
      siteUrlId: filters.siteUrlId,
      pageKind: filters.pageKind,
    }),
  ]);
  const items = groups.map((group) => ({
    group_id: group.group_id,
    crawl_id: crawl.id,
    rule_id: group.rule_id,
    page_kinds:
      siteLevelScope(group.rule_id, group.evidence)?.pageKinds ?? kinds.get(group.rule_id) ?? [],
    dimension: group.dimension,
    category: group.category,
    severity: group.severity,
    title: ruleTitle(group.rule_id),
    description: group.description,
    remediation: group.remediation,
    remediation_route: remediationRoute(group.rule_id),
    score_roles: ruleScoreRoles(group.rule_id),
    affected_url_count: group.affected_url_count,
    ...changeOf(group.rule_id),
    analyzer_version: group.analyzer_version,
    rule_version: group.rule_version,
    created_at: group.created_at.toISOString(),
  }));
  return siteIssuesPageSchema.shape.items.parse(items);
}

const catalogSchema = z.object({
  items: siteIssuesPageSchema.shape.items,
  summary: siteIssuesPageSchema.shape.summary.omit({ section_counts: true }),
});

async function persistedCatalog(db: Database, crawl: Crawl) {
  const row = await db
    .selectFrom('site_issue_catalogs')
    .select(['items', 'summary'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .executeTakeFirst();
  const parsed = row ? catalogSchema.safeParse(row) : null;
  return parsed?.success ? parsed.data : null;
}

type GroupRequest = { workspaceId: string; crawlId: string; groupId: string };
type DetailRequest = GroupRequest & {
  paging: Paging;
  siteUrlId?: string | null;
  pageKind?: string | null;
};

export async function issueGroup(
  db: Database,
  { workspaceId, crawlId, groupId, pageKind = null }: GroupRequest & { pageKind?: string | null },
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const candidates = await sql<{ rule_id: string }>`
    select distinct i.rule_id from site_issues i
    where ${currentIssues(crawl)}`.execute(db);
  const group = candidates.rows.find((row) => issueGroupId(crawl.id, row.rule_id) === groupId);
  if (group === undefined) throw notFound('Issue');
  const kindFilter = pageKind ? sql`and ${ofPageKind(crawl, pageKind)}` : sql``;
  const inGroup = sql`${currentIssues(crawl)} and i.rule_id = ${group.rule_id} ${kindFilter}`;
  const canonical = await sql<IssueRow>`select i.*, '' as reason_code from site_issues i
    where ${inGroup} order by i.created_at, i.id limit 1`.execute(db);
  const representative = canonical.rows[0];
  if (representative === undefined) throw notFound('Issue');
  return { crawl, groupId, pageKind, inGroup, representative };
}
export type IssueGroup = Awaited<ReturnType<typeof issueGroup>>;

export async function issueOccurrences(
  db: Database,
  group: IssueGroup,
  { paging, siteUrlId = null }: { paging: Paging; siteUrlId?: string | null },
) {
  const fingerprint = {
    crawl_id: group.crawl.id,
    group_id: group.groupId,
    site_url_id: siteUrlId,
    page_kind: group.pageKind,
  };
  let after = sql``;
  if (paging.cursor) {
    const [url, raw, ...rest] = decodeKeysetCursor(paging.cursor, 'issue_detail', fingerprint);
    const id = parseUuid(raw);
    if (url === undefined || id === null || rest.length > 0)
      throw new InvalidCursorError('invalid cursor');
    after = sql`and (u.normalized_url, i.id) > (${url}, ${id}::uuid)`;
  }
  const onePage = siteUrlId ? sql`and i.site_url_id = ${siteUrlId}::uuid` : sql``;
  const { rows } = await sql<
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
    join site_rule_evaluations e on e.analysis_id = i.analysis_id and e.id = i.evaluation_id
    where ${group.inGroup} ${after} ${onePage}
    order by u.normalized_url, i.id limit ${paging.limit + 1}`.execute(db);
  const page = rows.slice(0, paging.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      ...issueOccurrence(row, row),
      value: issueValue(row.rule_id, row.evidence),
    })),
    next_cursor:
      rows.length > paging.limit && last
        ? encodeKeysetCursor('issue_detail', fingerprint, [last.normalized_url, last.id])
        : null,
  };
}

export async function issueDetail(db: Database, request: DetailRequest) {
  const group = await issueGroup(db, request);
  const [totals, occurrences] = await Promise.all([
    sql<{ affected: number; occurrences: number }>`
      select count(distinct i.site_url_id)::int as affected, count(*)::int as occurrences
      from site_issues i where ${group.inGroup}`.execute(db),
    issueOccurrences(db, group, request),
  ]);
  const { representative } = group;
  const total = firstOf(totals.rows, 'the issue group totals');
  return siteIssueDetailSchema.parse({
    group_id: group.groupId,
    crawl_id: group.crawl.id,
    rule_id: representative.rule_id,
    dimension: representative.dimension,
    category: representative.category,
    severity: representative.severity,
    title: ruleTitle(representative.rule_id),
    description: representative.description,
    remediation: representative.remediation,
    remediation_route: remediationRoute(representative.rule_id),
    occurrences: occurrences.items,
    occurrence_count: total.occurrences,
    affected_url_count:
      siteLevelScope(representative.rule_id, representative.evidence, group.pageKind)?.affected ??
      total.affected,
    analyzer_version: representative.analyzer_version,
    rule_version: representative.rule_version,
    created_at: representative.created_at.toISOString(),
    next_cursor: occurrences.next_cursor,
  });
}
