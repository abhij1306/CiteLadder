/** One membership-scoped source set for active summaries and immutable snapshots. */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { aggregateMeasurements, aggregateByPageKind } from './analysis/measurement-aggregation.ts';
import { persistedEvaluation } from './terminal-analysis.ts';
import type { Crawl } from './task-fence.ts';
import { compareText, scalarText } from '../text-order.ts';

function classificationState(classified: number, expected: number) {
  if (!expected) return 'not_measured';
  return classified === expected ? 'complete' : 'partial';
}

export async function loadMeasurementProjection(db: Database, crawl: Crawl) {
  await db
    .selectFrom('site_health_profiles')
    .select('id')
    .where('id', '=', crawl.profile_id)
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const members = await db
    .selectFrom('monitored_site_urls')
    .select('site_url_id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('active', '=', true)
    .orderBy('site_url_id')
    .execute();
  const selectedIds = members.map((row) => row.site_url_id);
  const rows = await db
    .selectFrom('site_page_analyses as p')
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'p.site_url_id')
        .onRef('u.workspace_id', '=', 'p.workspace_id')
        .onRef('u.project_id', '=', 'p.project_id'),
    )
    .selectAll('p')
    .select('u.normalized_url')
    .distinctOn('p.site_url_id')
    .where('p.workspace_id', '=', crawl.workspace_id)
    .where('p.project_id', '=', crawl.project_id)
    .where('p.crawl_id', '=', crawl.id)
    .where('p.status', '=', 'completed')
    .where('p.site_url_id', '=', sql<string>`any(${selectedIds}::uuid[])`)
    .orderBy('p.site_url_id')
    .orderBy('p.created_at', 'desc')
    .orderBy('p.id', 'desc')
    .execute();
  const evaluationIds = [...new Set(rows.flatMap((row) => row.source_evaluation_ids ?? []))];
  const evaluations = await db
    .selectFrom('site_rule_evaluations')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('id', '=', sql<string>`any(${evaluationIds}::uuid[])`)
    .orderBy('id')
    .execute();
  const byId = new Map(evaluations.map((row) => [row.id, row]));
  const measured = rows.map((row) => ({
    id: row.id,
    page_kind: row.page_kind,
    evaluations: (row.source_evaluation_ids ?? []).flatMap((id) => {
      const evaluation = byId.get(id);
      return evaluation ? [persistedEvaluation(evaluation)] : [];
    }),
  }));
  const tasks = await db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .distinctOn('site_url_id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', crawl.id)
    .where('task_kind', '=', 'analyze')
    .where('site_url_id', '=', sql<string>`any(${selectedIds}::uuid[])`)
    .orderBy('site_url_id')
    .orderBy('generation', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const expected = tasks.filter((row) => row.classification_expected);
  const expectedByUrl = new Map(expected.map((row) => [row.site_url_id, row]));
  const completed = new Set<string>();
  const kinds: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const analysisIds: string[] = [];
  const artifactIds = new Set<string>();
  let classified = 0;
  let other = 0;
  let errors = 0;
  for (const row of rows) {
    if (expectedByUrl.get(row.site_url_id)?.result_artifact_id !== row.artifact_id) continue;
    completed.add(row.site_url_id);
    analysisIds.push(row.id);
    artifactIds.add(row.artifact_id);
    kinds[row.page_kind] = (kinds[row.page_kind] ?? 0) + 1;
    if (row.page_kind === 'other') {
      other++;
      const reason =
        scalarText(record(row.page_kind_evidence).other_reason) || 'page_purpose_unresolved';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    } else classified++;
  }
  for (const task of expected) {
    if (
      completed.has(task.site_url_id!) ||
      !['succeeded', 'failed', 'cancelled'].includes(task.status)
    )
      continue;
    errors++;
    const reason = task.error_code || 'classification_failed';
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    if (task.result_artifact_id) artifactIds.add(task.result_artifact_id);
  }
  const classification = {
    classified_page_count: classified,
    other_page_count: other,
    classification_error_page_count: errors,
    classification_expected_page_count: expected.length,
    classification_coverage: expected.length
      ? Math.round((classified / expected.length) * 10000) / 10000
      : null,
    classification_state: classificationState(classified, expected.length),
    classification_reason_groups: reasons,
    classification_formula_version: policy.site_health.reads.classification_formula_version,
    classification_source_analysis_ids: analysisIds.toSorted(compareText),
    classification_source_artifact_ids: [...artifactIds].toSorted(compareText),
    classification_source_task_ids: expected.map((row) => row.id).toSorted(compareText),
    scored_page_kind_set: Object.keys(kinds).toSorted(compareText),
    scored_page_count_by_kind: kinds,
  };
  return {
    selectedIds,
    rows,
    evaluations,
    tasks,
    classification,
    aggregate: aggregateMeasurements(measured),
    byPageKind: aggregateByPageKind(measured),
  };
}

export type MeasurementProjection = Awaited<ReturnType<typeof loadMeasurementProjection>>;
export function scoreSummary(projection: MeasurementProjection, issueCount: number) {
  const {
    readiness_dimensions: _dimensions,
    analyzed_url_count: analyzed,
    ...aggregate
  } = projection.aggregate;
  return {
    ...aggregate,
    search_eligibility: 'unknown',
    analyzed_count: analyzed,
    selected_count: projection.selectedIds.length,
    issue_count: issueCount,
    ...projection.classification,
    presentation_version: policy.site_health.reads.measurement_versions.presentation,
    by_page_kind: projection.byPageKind,
  };
}
