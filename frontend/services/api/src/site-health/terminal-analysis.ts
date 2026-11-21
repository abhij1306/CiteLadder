import { sql, type Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { timeOrderedId } from '../db/ids.ts';
import { record } from '../db/json.ts';
import type { SiteRuleEvaluations } from '../generated/db-schema.ts';
import type { RuleEvaluation } from './analysis/rules.ts';
import { crawlSiteChecks, finalPageChecks, scoreAnalysis } from './analysis/scoring.ts';
import type { Crawl } from './site-task.ts';

type StoredEvaluation = Omit<
  RuleEvaluation,
  'evidence' | 'score_roles' | 'description' | 'remediation'
> & { evidence: unknown; score_roles: string[] | null };

export function persistedEvaluation(row: StoredEvaluation): RuleEvaluation {
  return {
    ...row,
    evidence: record(row.evidence),
    score_roles: row.score_roles ?? [],
    description: '',
    remediation: '',
  };
}

export type SiteSources = Selectable<SiteRuleEvaluations>[];

export function crawlSiteSources(db: Database, crawl: Crawl): Promise<SiteSources> {
  return db
    .selectFrom('site_rule_evaluations')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('scope', '=', 'site')
    .where('outcome', '<>', 'not_applicable')
    .where('analysis_id', 'in', (eb) =>
      eb
        .selectFrom('site_page_analyses')
        .select(sql<string>`coalesce(supersedes_analysis_id, id)`.as('id'))
        .where('workspace_id', '=', crawl.workspace_id)
        .where('project_id', '=', crawl.project_id)
        .where('crawl_id', '=', crawl.id)
        .where('is_current', '=', true),
    )
    .orderBy('analysis_id')
    .orderBy('rule_id')
    .execute();
}

export async function appendFinalRevisions(
  db: Database,
  crawl: Crawl,
  analysisIds: string[],
  siteSources: SiteSources,
) {
  if (!analysisIds.length) return 0;
  const initials = await db
    .selectFrom('site_page_analyses')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('id', '=', sql<string>`any(${analysisIds}::uuid[])`)
    .where('is_current', '=', true)
    .where('finalized_at', 'is', null)
    .orderBy('site_url_id')
    .orderBy('id')
    .execute();
  if (!initials.length) return 0;
  const ids = initials.map((row) => row.id);
  const evaluations = await db
    .selectFrom('site_rule_evaluations')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('analysis_id', '=', sql<string>`any(${ids}::uuid[])`)
    .where('scope', '<>', 'site')
    .orderBy('analysis_id')
    .orderBy('rule_id')
    .execute();
  const byAnalysis = new Map<string, typeof evaluations>();
  for (const row of evaluations) {
    const group = byAnalysis.get(row.analysis_id) ?? [];
    group.push(row);
    byAnalysis.set(row.analysis_id, group);
  }
  await db
    .updateTable('site_page_analyses')
    .set({ is_current: false })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('id', '=', sql<string>`any(${ids}::uuid[])`)
    .execute();
  const artifacts = await db
    .selectFrom('site_fetch_artifacts')
    .select([
      'id',
      sql<unknown>`jsonb_build_object(
        'canonical_declarations', normalized_facts -> 'canonical_declarations',
        'canonical_url', normalized_facts -> 'canonical_url')`.as('facts'),
    ])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('id', '=', sql<string>`any(${initials.map((row) => row.artifact_id)}::uuid[])`)
    .execute();
  const factsOf = new Map(artifacts.map((row) => [row.id, record(row.facts)]));
  const site = crawlSiteChecks(siteSources.map(persistedEvaluation));
  const auditTime = crawl.started_at ?? crawl.created_at;
  const finalizedAt = new Date();
  const revisions = initials.map((initial) => {
    const own = byAnalysis.get(initial.id) ?? [];
    const sources = [...own, ...siteSources];
    const scores = scoreAnalysis(
      finalPageChecks(own.map(persistedEvaluation), factsOf.get(initial.artifact_id) ?? {}),
      initial.page_kind,
      site,
    );
    const byRule = new Map(sources.map((row) => [row.rule_id, row.id]));
    return {
      ...initial,
      ...scores,
      id: timeOrderedId(),
      created_at: finalizedAt,
      is_current: true,
      supersedes_analysis_id: initial.id,
      finalized_at: finalizedAt,
      scoring_version: policy.site_health.reads.scoring_version,
      source_evaluation_ids: sources.map((row) => row.id),
      source_artifact_ids: initial.source_artifact_ids?.length
        ? initial.source_artifact_ids
        : [initial.artifact_id],
      page_kind_evidence:
        initial.page_kind_evidence === null ? null : JSON.stringify(initial.page_kind_evidence),
      expected_checkpoint_profile: JSON.stringify(
        scores.expected_checkpoint_profile.map((entry) => ({
          ...entry,
          evaluation_id: byRule.get(entry.check_id),
          audit_time: auditTime ? new Date(auditTime).toISOString() : null,
        })),
      ),
      readiness_dimensions: JSON.stringify(scores.readiness_dimensions),
    };
  });
  // A batch is a few hundred pages, far under PostgreSQL's 65535 bind-parameter limit.
  await db.insertInto('site_page_analyses').values(revisions).execute();
  return revisions.length;
}
