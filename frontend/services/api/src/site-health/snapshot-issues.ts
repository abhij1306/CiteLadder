/**
 * Issue counts and ranked groups over the terminal evaluation manifest. The
 * snapshot's manifest grows once more when the site-level architecture
 * evaluations that run after it are folded in (`addArchitectureIssues`).
 */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { issueImpact } from './reads/rules.ts';
import type { Crawl } from './task-fence.ts';
import { compareText } from '../text-order.ts';

export async function snapshotIssues(db: Database, crawl: Crawl, evaluationIds: string[]) {
  const rows = await db
    .selectFrom('site_issues as i')
    .innerJoin('site_rule_evaluations as e', (join) =>
      join
        .onRef('e.id', '=', 'i.evaluation_id')
        .onRef('e.workspace_id', '=', 'i.workspace_id')
        .onRef('e.analysis_id', '=', 'i.analysis_id')
        .onRef('e.rule_id', '=', 'i.rule_id'),
    )
    .select([
      'i.rule_id',
      'i.finding_class',
      'i.severity',
      'i.category',
      'i.site_url_id',
      'i.description',
      'i.remediation',
      'e.score_roles',
      'e.scope',
    ])
    .where('i.workspace_id', '=', crawl.workspace_id)
    .where('i.project_id', '=', crawl.project_id)
    .where('i.crawl_id', '=', crawl.id)
    .where('i.evaluation_id', '=', sql<string>`any(${evaluationIds}::uuid[])`)
    .execute();
  const severities: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const groups = new Map<
    string,
    { row: (typeof rows)[number]; roles: Set<string>; urls: Set<string> }
  >();
  const technicalPages = new Set<string>();
  const readinessPages = new Set<string>();
  let technical = 0;
  let readiness = 0;
  for (const row of rows) {
    severities[row.severity] = (severities[row.severity] ?? 0) + 1;
    categories[row.category] = (categories[row.category] ?? 0) + 1;
    const roles = row.score_roles ?? [];
    if (row.finding_class === 'defect' && roles.includes('web_fundamentals')) {
      technical++;
      technicalPages.add(row.site_url_id);
    }
    if (roles.includes('aeo_readiness')) {
      readiness++;
      if (row.scope === 'page') readinessPages.add(row.site_url_id);
    }
    const key = `${row.rule_id}:${row.finding_class}`;
    const group = groups.get(key) ?? { row, roles: new Set<string>(), urls: new Set<string>() };
    for (const role of roles) group.roles.add(role);
    group.urls.add(row.site_url_id);
    groups.set(key, group);
  }
  const top = [...groups.values()]
    .map(({ row, roles, urls }) => {
      const impact = issueImpact(row.rule_id, row.finding_class, row.severity);
      return {
        rule_id: row.rule_id,
        finding_class: row.finding_class,
        severity: row.severity,
        category: row.category,
        description: row.description,
        remediation: row.remediation,
        score_roles: [...roles].toSorted(compareText),
        affected_pages: urls.size,
        eligibility_blocker: row.rule_id === 'technical.indexable',
        impact_band: impact.band,
        impact_label: impact.label,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligibility_blocker) - Number(a.eligibility_blocker) ||
        b.impact_band - a.impact_band ||
        Number(b.finding_class === 'defect') - Number(a.finding_class === 'defect') ||
        b.affected_pages - a.affected_pages ||
        compareText(a.rule_id, b.rule_id),
    );
  return {
    issue_count: rows.length,
    severity_counts: severities,
    category_counts: categories,
    top_issues: top.slice(0, 10),
    technical_defect_count: technical,
    technical_defect_affected_page_count: technicalPages.size,
    aeo_readiness_gap_count: readiness,
    aeo_readiness_gap_affected_page_count: readinessPages.size,
  };
}
