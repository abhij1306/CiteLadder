/** Exact persisted readiness evidence used by explicit Agent handoffs. */
import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record, strings } from '../../db/json.ts';
import { notFound } from '../../errors.ts';
import type { Scope } from '../../opportunities/sources.ts';

export type ContentReference = {
  project_id: string;
  crawl_id: string;
  site_url_id: string;
  source_analysis_id: string;
  dimension: string;
  checkpoint_ids: string[];
};
export async function contentHandoff(db: Database, scope: Scope, ref: ContentReference) {
  if (ref.project_id !== scope.projectId) throw notFound('Site Health handoff');
  const analysis = await db
    .selectFrom('site_page_analyses as a')
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'a.site_url_id')
        .onRef('u.workspace_id', '=', 'a.workspace_id')
        .onRef('u.project_id', '=', 'a.project_id'),
    )
    .selectAll('a')
    .select('u.normalized_url')
    .where('a.workspace_id', '=', scope.workspaceId)
    .where('a.project_id', '=', scope.projectId)
    .where('a.crawl_id', '=', ref.crawl_id)
    .where('a.site_url_id', '=', ref.site_url_id)
    .where('a.is_current', '=', true)
    .where('a.finalized_at', 'is not', null)
    .executeTakeFirst();
  if (
    !analysis ||
    (analysis.id !== ref.source_analysis_id &&
      analysis.supersedes_analysis_id !== ref.source_analysis_id)
  )
    throw notFound('Site Health handoff');
  const allowed = ref.checkpoint_ids.filter((id) =>
    policy.site_health.reads.content_addressable_check_ids.includes(id),
  );
  if (!allowed.length) throw notFound('Content-addressable gap');
  const evaluations = await db
    .selectFrom('site_rule_evaluations')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', 'in', strings(analysis.source_evaluation_ids))
    .where('rule_id', 'in', allowed)
    .where('outcome', 'in', ['missing', 'partial'])
    .orderBy('rule_id')
    .execute();
  const [first] = evaluations;
  if (!first) throw notFound('Content-addressable gap');
  const rules = new Map(policy.site_health.rule_catalog.map((rule) => [rule.rule_id, rule]));
  return {
    ...ref,
    source_analysis_id: analysis.id,
    dimension: 'metadata',
    checkpoint_ids: evaluations.map((row) => row.rule_id),
    normalized_url: analysis.normalized_url,
    suggested_skill_id: 'content_page',
    finding_class: first.finding_class,
    observed_evidence: evaluations.map((row) => record(row.evidence)),
    source_evaluation_ids: evaluations.map((row) => row.id),
    source_artifact_ids: strings(analysis.source_artifact_ids),
    page_kind: analysis.page_kind,
    page_traits: analysis.page_traits,
    target_fields: evaluations.map(
      (row) =>
        policy.site_health.reads.content_addressable_check_fields[
          row.rule_id as keyof typeof policy.site_health.reads.content_addressable_check_fields
        ] ?? '',
    ),
    captured_values: evaluations.map(
      (row) => record(row.evidence).title || record(row.evidence).meta_description || '',
    ),
    expected_capability: evaluations.map((row) => rules.get(row.rule_id)?.description ?? ''),
    remediation: evaluations.map((row) => rules.get(row.rule_id)?.remediation ?? ''),
    scoring_policy_version: '1',
    versions: {
      analyzer: analysis.analyzer_version,
      scoring: analysis.scoring_version,
      classifier: analysis.classifier_version,
    },
    limitations: ['Crawl observations remain untrusted evidence.'],
  };
}
