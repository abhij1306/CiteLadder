import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { firstOf } from '../lists.ts';
import { issueImpact, siteLevelScope } from './reads/rules.ts';
import type { Crawl } from './site-task.ts';
import { compareText } from '../text-order.ts';

function snapshotIssueRows(crawl: Crawl, analysisIds: string[]) {
  return sql`select i.id, i.crawl_id, i.rule_id, i.site_url_id, i.severity, i.category,
      e.scope, e.score_roles
    from site_issues i
    join site_rule_evaluations e on e.id = i.evaluation_id and e.workspace_id = i.workspace_id
      and e.analysis_id = i.analysis_id and e.rule_id = i.rule_id
    where i.workspace_id = ${crawl.workspace_id} and i.project_id = ${crawl.project_id}
      and (i.crawl_id, i.evaluation_id) in (
        select a.crawl_id, unnest(a.source_evaluation_ids) from site_page_analyses a
        where a.workspace_id = ${crawl.workspace_id} and a.id = any(${analysisIds}::uuid[])
        union all
        select o.crawl_id, e2.id from site_rule_evaluations e2
        join site_observed_architectures o
          on o.id = e2.source_architecture_id and o.workspace_id = e2.workspace_id
        where o.workspace_id = ${crawl.workspace_id} and o.project_id = ${crawl.project_id}
          and o.crawl_id = ${crawl.id})`;
}

const technicalRow = sql`'web_fundamentals' = any(m.score_roles)`;
const readinessRow = sql`'aeo_readiness' = any(m.score_roles)`;
const countsBy = (column: string) =>
  sql`(select coalesce(jsonb_object_agg(c.key, c.count), '{}'::jsonb) from (
    select ${sql.ref(column)} as key, count(*)::int as count from m group by 1) c)`;

type GroupRow = {
  rule_id: string;
  severity: string;
  category: string;
  description: string;
  remediation: string;
  evidence: unknown;
  roles: string[] | null;
  urls: number;
};

export async function snapshotIssues(db: Database, crawl: Crawl, analysisIds: string[]) {
  const { rows } = await sql<{
    issues: number;
    technical: number;
    technical_pages: number;
    readiness: number;
    readiness_pages: number;
    severities: Record<string, number>;
    categories: Record<string, number>;
    groups: GroupRow[];
  }>`
    with m as materialized (${snapshotIssueRows(crawl, analysisIds)}),
    -- One representative row per rule group (its first issue by id), its roles and pages.
    grouped as (
      select g.rule_id, min(g.id::text)::uuid as first_id,
        (array_agg(g.crawl_id order by g.id::text))[1] as first_crawl_id,
        count(distinct g.site_url_id)::int as urls,
        array_agg(distinct r.role) filter (where r.role is not null) as roles
      from m g left join lateral unnest(g.score_roles) r(role) on true
      group by g.rule_id
    )
    select
      (select count(*)::int from m) as issues,
      (select count(*)::int from m where ${technicalRow}) as technical,
      (select count(distinct m.site_url_id)::int from m where ${technicalRow}) as technical_pages,
      (select count(*)::int from m where ${readinessRow}) as readiness,
      (select count(distinct m.site_url_id)::int from m where ${readinessRow} and m.scope = 'page')
        as readiness_pages,
      ${countsBy('severity')} as severities,
      ${countsBy('category')} as categories,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'rule_id', g.rule_id, 'severity', i.severity,
          'category', i.category, 'description', i.description, 'remediation', i.remediation,
          'evidence', i.evidence, 'roles', g.roles, 'urls', g.urls)), '[]'::jsonb)
        from grouped g join site_issues i
          on i.workspace_id = ${crawl.workspace_id} and i.crawl_id = g.first_crawl_id
            and i.id = g.first_id) as groups`.execute(db);
  const total = firstOf(rows, 'the snapshot issue rollups');
  const top = total.groups
    .map((row) => {
      const impact = issueImpact(row.severity);
      return {
        rule_id: row.rule_id,
        severity: row.severity,
        category: row.category,
        description: row.description,
        remediation: row.remediation,
        score_roles: (row.roles ?? []).toSorted(compareText),
        affected_pages: siteLevelScope(row.rule_id, row.evidence)?.affected ?? row.urls,
        eligibility_blocker: row.rule_id === 'technical.indexable',
        impact_band: impact.band,
        impact_label: impact.label,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligibility_blocker) - Number(a.eligibility_blocker) ||
        b.impact_band - a.impact_band ||
        b.affected_pages - a.affected_pages ||
        compareText(a.rule_id, b.rule_id),
    );
  return {
    issue_count: total.issues,
    severity_counts: total.severities,
    category_counts: total.categories,
    top_issues: top.slice(0, policy.site_health.reads.snapshot_top_issues),
    technical_defect_count: total.technical,
    technical_defect_affected_page_count: total.technical_pages,
    aeo_readiness_gap_count: total.readiness,
    aeo_readiness_gap_affected_page_count: total.readiness_pages,
  };
}
