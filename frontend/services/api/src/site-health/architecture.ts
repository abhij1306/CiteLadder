/** Immutable observed architecture and root-anchored findings from persisted evidence. */
import { randomUUID } from 'node:crypto';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { canonicalUrl } from './url-identity.ts';
import { buildArchitecture, type ArchitecturePage } from './architecture-model.ts';
import { architectureRules } from './architecture-rules.ts';
import { addArchitectureIssues } from './snapshot.ts';
import type { Crawl } from './task-fence.ts';

function string(value: unknown) {
  return typeof value === 'string' ? value : '';
}
function indexability(outcome: string): boolean | null {
  if (outcome === 'satisfied') return true;
  if (outcome === 'missing') return false;
  return null;
}
async function architecturePages(db: Database, crawl: Crawl) {
  const rows = await db
    .selectFrom('site_page_analyses as analysis')
    .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
    .innerJoin('site_fetch_artifacts as artifact', 'artifact.id', 'analysis.artifact_id')
    .innerJoin('site_page_link_metrics as metric', (join) =>
      join
        .onRef('metric.site_url_id', '=', 'analysis.site_url_id')
        .onRef('metric.crawl_id', '=', 'analysis.crawl_id'),
    )
    .select([
      'url.id',
      'url.normalized_url',
      'analysis.id as analysisId',
      'analysis.page_kind',
      'analysis.source_evaluation_ids',
      'artifact.id as artifactId',
      'artifact.final_url',
      'artifact.normalized_facts',
      'metric.id as metricId',
      'metric.depth_from_home',
      'metric.inbound_count',
      'metric.outbound_count',
      'metric.main_content_outbound_count',
    ])
    .where('analysis.workspace_id', '=', crawl.workspace_id)
    .where('analysis.project_id', '=', crawl.project_id)
    .where('analysis.crawl_id', '=', crawl.id)
    .where('analysis.status', '=', 'completed')
    .where('analysis.is_current', '=', true)
    .where('analysis.analyzer_version', '=', crawl.analyzer_version)
    .where('url.workspace_id', '=', crawl.workspace_id)
    .where('url.project_id', '=', crawl.project_id)
    .where('artifact.workspace_id', '=', crawl.workspace_id)
    .where('artifact.crawl_id', '=', crawl.id)
    .where('artifact.extractor_version', '=', crawl.extractor_version)
    .where('metric.workspace_id', '=', crawl.workspace_id)
    .where('metric.project_id', '=', crawl.project_id)
    .where('metric.extractor_version', '=', crawl.extractor_version)
    .where('metric.formula_version', '=', policy.site_health.link_metrics.formula_version)
    .orderBy('url.normalized_url')
    .orderBy('url.id')
    .limit(policy.site_health.architecture.max_pages + 1)
    .execute();
  const selected = rows.slice(0, policy.site_health.architecture.max_pages);
  const owners = new Map(
    selected.flatMap((row) =>
      (row.source_evaluation_ids ?? []).map((id) => [id, row.analysisId] as const),
    ),
  );
  const evaluations = owners.size
    ? await db
        .selectFrom('site_rule_evaluations')
        .select(['id', 'analysis_id', 'outcome'])
        .where('workspace_id', '=', crawl.workspace_id)
        .where('id', 'in', [...owners.keys()])
        .where('rule_id', '=', 'technical.indexable')
        .execute()
    : [];
  const verdicts = new Map(
    evaluations
      .filter((row) => owners.get(row.id) === row.analysis_id)
      .map((row) => [row.analysis_id, indexability(row.outcome)]),
  );
  const pages: ArchitecturePage[] = selected.flatMap((row) => {
    const url = canonicalUrl(row.final_url || row.normalized_url) ?? '';
    if (!url) return [];
    const facts = record(row.normalized_facts);
    return [
      {
        id: row.id,
        analysisId: row.analysisId,
        artifactId: row.artifactId,
        metricId: row.metricId,
        url,
        title: string(facts.title),
        description: string(facts.meta_description),
        kind: row.page_kind,
        depth: row.depth_from_home,
        inbound: row.inbound_count,
        outbound: row.outbound_count,
        contentOutbound: row.main_content_outbound_count,
        indexable: verdicts.get(row.analysisId) ?? null,
        facts,
      },
    ];
  });
  return {
    pages,
    capped: rows.length > selected.length,
    evaluationIds: evaluations
      .filter((row) => owners.get(row.id) === row.analysis_id)
      .map((row) => row.id),
  };
}
async function persistRules(
  db: Database,
  crawl: Crawl,
  architectureId: string,
  root: ArchitecturePage,
  pages: ArchitecturePage[],
  evaluations: ReturnType<typeof architectureRules>,
) {
  const versions = policy.site_health.versions;
  for (const evaluation of evaluations) {
    const { rule } = evaluation;
    const now = new Date();
    const row = await db
      .insertInto('site_rule_evaluations')
      .values({
        id: randomUUID(),
        workspace_id: crawl.workspace_id,
        analysis_id: root.analysisId,
        source_artifact_id: root.artifactId,
        source_architecture_id: architectureId,
        rule_id: rule.rule_id,
        rule_version: rule.rule_version,
        dimension: rule.dimension,
        category: rule.category,
        severity: rule.severity,
        finding_class: rule.finding_class,
        scope: rule.scope,
        weight: rule.weight,
        outcome: evaluation.outcome,
        display_applicability: true,
        score_applicability: false,
        reason_code: evaluation.reason,
        score_roles: [],
        readiness_dimension: '',
        readiness_weight: 0,
        evidence: JSON.stringify(evaluation.evidence),
        supporting_artifact_ids: pages.map((page) => page.artifactId),
        extractor_version: crawl.extractor_version || versions.extractor,
        analyzer_version: crawl.analyzer_version || versions.analyzer,
        created_at: now,
      })
      .onConflict((conflict) => conflict.constraint('uq_site_rule_evaluation').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!row || evaluation.outcome !== 'missing' || rule.finding_class === 'diagnostic') continue;
    await db
      .insertInto('site_issues')
      .values({
        id: randomUUID(),
        workspace_id: crawl.workspace_id,
        project_id: crawl.project_id,
        crawl_id: crawl.id,
        site_url_id: root.id,
        analysis_id: root.analysisId,
        evaluation_id: row.id,
        source_artifact_id: root.artifactId,
        rule_id: rule.rule_id,
        dimension: rule.dimension,
        category: rule.category,
        severity: rule.severity,
        finding_class: rule.finding_class,
        evidence: JSON.stringify(evaluation.evidence),
        description: rule.description,
        remediation: rule.remediation,
        analyzer_version: crawl.analyzer_version || versions.analyzer,
        rule_version: rule.rule_version,
        created_at: now,
      })
      .execute();
  }
}
export async function persistArchitecture(db: Database, crawl: Crawl) {
  const snapshot = await db
    .selectFrom('site_health_snapshots')
    .select(['id', 'coverage_state'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .executeTakeFirst();
  if (!snapshot) return 0;
  const { pages, evaluationIds, capped } = await architecturePages(db, crawl);
  const root = pages.find((page) => page.kind === 'homepage') ?? pages[0];
  if (!root) return 0;
  const profile = await db
    .selectFrom('brand_profiles')
    .select(['id', 'business_context'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .executeTakeFirst();
  const coverage = capped ? 'partial' : snapshot.coverage_state;
  const model = buildArchitecture(pages, coverage, profile?.business_context);
  const versions = policy.site_health.versions;
  const row = await db
    .insertInto('site_observed_architectures')
    .values({
      id: randomUUID(),
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      crawl_id: crawl.id,
      source_snapshot_id: snapshot.id,
      source_brand_profile_id: profile?.id ?? null,
      coverage_state: coverage,
      page_count: model.hierarchy.length,
      page_kinds: JSON.stringify(model.page_kinds),
      internal_linking: JSON.stringify(model.internal_linking),
      structure_depth: JSON.stringify(model.structure_depth),
      hierarchy: JSON.stringify(model.hierarchy),
      archetype: JSON.stringify(model.archetype),
      source_analysis_ids: pages.map((page) => page.analysisId),
      source_artifact_ids: pages.map((page) => page.artifactId),
      source_evaluation_ids: evaluationIds,
      source_link_metric_ids: pages.map((page) => page.metricId),
      extractor_version: crawl.extractor_version || versions.extractor,
      analyzer_version: crawl.analyzer_version || versions.analyzer,
      rule_version: crawl.rule_catalog_version || versions.rules,
      architecture_formula_version: versions.architecture,
      archetype_policy_version: versions.archetype,
      created_at: new Date(),
    })
    .onConflict((conflict) => conflict.constraint('uq_site_observed_architecture').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!row) return 0;
  await persistRules(db, crawl, row.id, root, pages, architectureRules(model, pages, coverage));
  // The snapshot was published first (architecture reads its coverage); its
  // issue counts now take in the site-level findings.
  await addArchitectureIssues(db, crawl);
  return 1;
}
