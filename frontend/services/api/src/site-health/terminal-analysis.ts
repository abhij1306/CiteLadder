/** Append terminal revisions while retaining evaluations on their original analyses. */
import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { firstOf } from '../lists.ts';
import type { SiteRuleEvaluations } from '../generated/db-schema.ts';
import type { RuleEvaluation } from './analysis/rules.ts';
import { appliedSiteChecks, crawlSiteChecks, scoreAnalysis } from './analysis/scoring.ts';
import type { Crawl } from './task-fence.ts';

export function persistedEvaluation(row: Selectable<SiteRuleEvaluations>): RuleEvaluation {
  return {
    ...row,
    evidence: record(row.evidence),
    score_roles: row.score_roles ?? [],
    description: '',
    remediation: '',
  };
}

/** Caller holds the crawl lock and owns the terminal publication transaction. */
export async function publishFinalPageAnalyses(db: Database, crawl: Crawl) {
  const initials = await db
    .selectFrom('site_page_analyses')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .where('is_current', '=', true)
    .where('finalized_at', 'is', null)
    .orderBy('site_url_id')
    .orderBy('id')
    .execute();
  if (!initials.length) return;
  const ids = initials.map((row) => row.id);
  const evaluations = await db
    .selectFrom('site_rule_evaluations')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('analysis_id', '=', sql<string>`any(${ids}::uuid[])`)
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
  // Site checks score on every page, so each page's manifest names the site evaluations it used.
  const siteSources = evaluations.filter(
    (row) => appliedSiteChecks([persistedEvaluation(row)]).length > 0,
  );
  // Scored site checks the crawl never evaluated score as unknown, with no source to name.
  const site = crawlSiteChecks(siteSources.map(persistedEvaluation));
  const auditTime = crawl.started_at ?? crawl.created_at;
  const finalizedAt = new Date();
  const revisions = initials.map((initial) => {
    const own = (byAnalysis.get(initial.id) ?? []).filter((row) => row.scope !== 'site');
    const sources = [...own, ...siteSources];
    const scores = scoreAnalysis(own.map(persistedEvaluation), initial.page_kind, site);
    const byRule = new Map(sources.map((row) => [row.rule_id, row.id]));
    return {
      ...initial,
      ...scores,
      id: randomUUID(),
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
  // Chunked only to stay under PostgreSQL's 65535 bind-parameter limit.
  const first = firstOf(revisions, 'a revision of an unfinalized analysis');
  const chunk = Math.floor(65_535 / Object.keys(first).length);
  for (let offset = 0; offset < revisions.length; offset += chunk)
    await db // NOSONAR: in order in the caller's one publication transaction.
      .insertInto('site_page_analyses')
      .values(revisions.slice(offset, offset + chunk))
      .execute();
}
