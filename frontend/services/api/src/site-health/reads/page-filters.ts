import { sql, type RawBuilder } from 'kysely';

import { containsPattern } from '../../db/like.ts';

export const PAGE_SCORE_ROLES = ['web_fundamentals', 'aeo_readiness'] as const;
type PageScoreRole = (typeof PAGE_SCORE_ROLES)[number];

const SCORE_COLUMNS: Record<PageScoreRole, string> = {
  web_fundamentals: 'a.web_fundamentals_score',
  aeo_readiness: 'a.aeo_readiness_score',
};

export type PageRowFilters = {
  status?: string | null;
  monitored?: boolean | null;
  pageKind?: string | null;
  query?: string | null;
  siteUrlId?: string;
  rule?: string | null;
  withIssues?: boolean | null;
  indexable?: boolean | null;
  minDepth?: number | null;
  maxDepth?: number | null;
  score?: { role: PageScoreRole; max: number } | null;
};

export function pageFilterFingerprint(filters: PageRowFilters) {
  return {
    status: filters.status ?? null,
    monitored: filters.monitored ?? null,
    page_kind: filters.pageKind ?? null,
    query: filters.query?.trim().toLowerCase() || null,
    rule: filters.rule ?? null,
    with_issues: filters.withIssues ?? null,
    indexable: filters.indexable ?? null,
    min_depth: filters.minDepth ?? null,
    max_depth: filters.maxDepth ?? null,
    score_role: filters.score?.role ?? null,
    max_score: filters.score?.max ?? null,
  };
}

function identityClauses(filters: PageRowFilters) {
  const search = filters.query?.trim().toLowerCase();
  const pattern = search ? containsPattern(search) : null;
  return [
    filters.siteUrlId ? sql`and u.id = ${filters.siteUrlId}` : null,
    pattern
      ? sql`and (lower(u.normalized_url) like ${pattern} or lower(u.display_url) like ${pattern})`
      : null,
    filters.pageKind ? sql`and a.page_kind = ${filters.pageKind}` : null,
    filters.monitored === false ? sql`and m.site_url_id is null` : null,
  ];
}

function issueClauses(filters: PageRowFilters, shownIssue: RawBuilder<unknown>) {
  const issueExists = (rule: string | null) => sql`and exists (
    select 1 from site_issues i
    where i.workspace_id = u.workspace_id ${rule === null ? sql`` : sql`and i.rule_id = ${rule}`}
      and ${shownIssue})`;
  return [
    filters.rule ? issueExists(filters.rule) : null,
    filters.withIssues ? issueExists(null) : null,
  ];
}

function measureClauses(filters: PageRowFilters) {
  const { indexable, minDepth, maxDepth, score } = filters;
  return [
    typeof indexable === 'boolean' ? sql`and a.main_content_indexable = ${indexable}` : null,
    typeof minDepth === 'number' ? sql`and l.depth_from_home >= ${minDepth}` : null,
    typeof maxDepth === 'number' ? sql`and l.depth_from_home <= ${maxDepth}` : null,
    score ? sql`and round(${sql.ref(SCORE_COLUMNS[score.role])}) <= ${score.max}` : null,
  ];
}

export function pageFilterSql(filters: PageRowFilters, shownIssue: RawBuilder<unknown>) {
  const present = [
    ...identityClauses(filters),
    ...issueClauses(filters, shownIssue),
    ...measureClauses(filters),
  ].filter((clause) => clause !== null);
  return present.length ? sql.join(present, sql` `) : sql``;
}
