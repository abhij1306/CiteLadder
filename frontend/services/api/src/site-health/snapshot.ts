/** The terminal snapshot and matching crawl summary publish in one transaction. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { numberRecord } from '../db/json.ts';
import { crawlCoverage } from './coverage.ts';
import {
  loadMeasurementProjection,
  scoreSummary,
  type MeasurementProjection,
} from './score-summary.ts';
import { readinessDiagnostic, webDiagnostic } from './snapshot-diagnostics.ts';
import { snapshotEligibility } from './snapshot-eligibility.ts';
import { snapshotIssues } from './snapshot-issues.ts';
import type { Crawl } from './task-fence.ts';
import { compareText } from '../text-order.ts';

const reads = policy.site_health.reads;
const versions = reads.measurement_versions;
const metrics = [
  ['web_fundamentals_score', 'Web Fundamentals'],
  ['web_fundamentals_coverage', 'Web Fundamentals coverage'],
  ['aeo_readiness_score', 'AEO Readiness'],
  ['aeo_measurement_coverage', 'AEO coverage'],
] as const;

function comparisonReason(comparable: boolean, compositionChanged: boolean) {
  if (!comparable) return 'no_comparable_snapshot';
  return compositionChanged ? 'cohort_composition_changed' : 'comparable_snapshot';
}

function direction(delta: number | null) {
  if (delta === null) return 'unavailable';
  if (delta > 0) return 'increased';
  return delta < 0 ? 'decreased' : 'unchanged';
}

async function history(db: Database, crawl: Crawl, projection: MeasurementProjection, now: Date) {
  const rows = await db
    .selectFrom('site_health_snapshots')
    .selectAll()
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '!=', crawl.id)
    .where('analyzer_version', '=', crawl.analyzer_version || policy.site_health.versions.analyzer)
    .where('scoring_version', '=', crawl.scoring_version || reads.scoring_version)
    .where('profile_version', '=', versions.profile)
    .where('schema_contract_version', '=', versions.schema_contract)
    .where('presentation_version', '=', versions.presentation)
    .where('coverage_formula_version', '=', reads.coverage_formula_version)
    .where('classification_formula_version', '=', reads.classification_formula_version)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(reads.overview_trend_point_limit - 1)
    .execute();
  rows.reverse();
  const previous = rows.at(-1);
  const previousCounts = numberRecord(previous?.scored_page_count_by_kind);
  const currentCounts = projection.classification.scored_page_count_by_kind;
  const keys = [...new Set([...Object.keys(previousCounts), ...Object.keys(currentCounts)])];
  const changed = keys.some((key) => previousCounts[key] !== currentCounts[key]);
  const common = {
    state: previous ? 'measured' : 'unavailable',
    reason: comparisonReason(Boolean(previous), changed),
    cohort_composition: {
      added_page_kinds: Object.keys(currentCounts)
        .filter((key) => !(key in previousCounts))
        .toSorted(compareText),
      removed_page_kinds: Object.keys(previousCounts)
        .filter((key) => !(key in currentCounts))
        .toSorted(compareText),
      previous_page_count_by_kind: previousCounts,
      current_page_count_by_kind: currentCounts,
    },
  };
  return {
    trend: {
      ...common,
      metric: 'aeo_readiness_score',
      series: [
        ...rows.map((row) => ({
          label: new Date(row.created_at).toISOString().slice(0, 10),
          value: row.aeo_readiness_score,
        })),
        { label: now.toISOString().slice(0, 10), value: projection.aggregate.aeo_readiness_score },
      ],
    },
    change_summary: {
      ...common,
      metrics: metrics.map(([key, label]) => {
        const before = previous?.[key] ?? null;
        const current = projection.aggregate[key];
        const delta =
          before === null || current === null
            ? null
            : Math.round((current - before) * 10000) / 10000;
        return {
          key,
          label,
          previous: before,
          current,
          delta,
          direction: direction(delta),
        };
      }),
    },
  };
}

export async function persistCrawlSnapshot(db: Database, crawl: Crawl, persistEmpty = false) {
  const projection = await loadMeasurementProjection(db, crawl);
  if (
    !persistEmpty &&
    !projection.rows.length &&
    !projection.classification.classification_expected_page_count
  )
    return false;
  const evaluationIds = projection.evaluations.map((row) => row.id);
  const issues = await snapshotIssues(db, crawl, evaluationIds);
  const eligibility = await snapshotEligibility(db, crawl, projection);
  const coverage = await crawlCoverage(db, crawl);
  const expected = projection.evaluations.filter(
    (row) => row.score_roles?.length && row.outcome !== 'not_applicable',
  );
  const measured = expected.filter((row) => ['satisfied', 'missing'].includes(row.outcome));
  const now = new Date();
  const trends = await history(db, crawl, projection, now);
  const {
    readiness_dimensions: dimensions,
    scoring_version: _scoring,
    ...aggregate
  } = projection.aggregate;
  const inserted = await db
    .insertInto('site_health_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      crawl_id: crawl.id,
      selected_url_count: projection.selectedIds.length,
      ...aggregate,
      ...projection.classification,
      classification_reason_groups: JSON.stringify(
        projection.classification.classification_reason_groups,
      ),
      scored_page_count_by_kind: JSON.stringify(
        projection.classification.scored_page_count_by_kind,
      ),
      readiness_dimensions: JSON.stringify(dimensions),
      aeo_readiness_diagnostic: JSON.stringify(readinessDiagnostic(crawl, projection)),
      ...eligibility,
      eligibility_totals: JSON.stringify(eligibility.eligibility_totals),
      eligibility_reasons: JSON.stringify(eligibility.eligibility_reasons),
      status_counts: JSON.stringify(eligibility.status_counts),
      ...issueColumns(issues),
      web_fundamentals: JSON.stringify(webDiagnostic(projection)),
      trend: JSON.stringify(trends.trend),
      change_summary: JSON.stringify(trends.change_summary),
      coverage_state: coverage.state,
      coverage_evidence: JSON.stringify({
        ...coverage.evidence,
        measured_check_count: measured.length,
        expected_check_count: expected.length,
      }),
      coverage_formula_version: reads.coverage_formula_version,
      source_analysis_ids: projection.rows.map((row) => row.id),
      source_artifact_ids: projection.rows.map((row) => row.artifact_id),
      source_evaluation_ids: evaluationIds,
      analyzer_version: crawl.analyzer_version || policy.site_health.versions.analyzer,
      scoring_version: crawl.scoring_version || reads.scoring_version,
      profile_version: versions.profile,
      schema_contract_version: versions.schema_contract,
      presentation_version: versions.presentation,
      created_at: now,
    })
    .onConflict((conflict) => conflict.constraint('uq_site_health_snapshot_crawl').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!inserted) return false;
  await db
    .updateTable('site_crawls')
    .set({
      score_summary: JSON.stringify({
        ...scoreSummary(projection, issues.issue_count),
        search_eligibility: eligibility.search_eligibility,
      }),
    })
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
  return true;
}

/** The snapshot's issue columns, with their JSON rollups serialized. */
function issueColumns(issues: Awaited<ReturnType<typeof snapshotIssues>>) {
  return {
    ...issues,
    top_issues: JSON.stringify(issues.top_issues),
    severity_counts: JSON.stringify(issues.severity_counts),
    category_counts: JSON.stringify(issues.category_counts),
  };
}

/**
 * Graph-scope architecture rules run as a successor of the snapshot (they read
 * its coverage), so their evaluations join its manifest afterwards: the issue
 * rollups and the crawl summary's count then cover every persisted issue.
 * Replay-safe: the manifest is a set and the rollups are recomputed from it.
 */
export async function addArchitectureIssues(db: Database, crawl: Crawl) {
  const architectureEvaluations = await db
    .selectFrom('site_rule_evaluations as e')
    .innerJoin('site_observed_architectures as a', (join) =>
      join
        .onRef('a.id', '=', 'e.source_architecture_id')
        .onRef('a.workspace_id', '=', 'e.workspace_id'),
    )
    .select('e.id')
    .where('a.workspace_id', '=', crawl.workspace_id)
    .where('a.project_id', '=', crawl.project_id)
    .where('a.crawl_id', '=', crawl.id)
    .orderBy('e.id')
    .execute();
  if (!architectureEvaluations.length) return false;
  const snapshot = await db
    .selectFrom('site_health_snapshots')
    .select(['id', 'source_evaluation_ids'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .forUpdate()
    .executeTakeFirst();
  if (!snapshot) return false;
  const known = new Set(snapshot.source_evaluation_ids ?? []);
  const added = architectureEvaluations.filter((row) => !known.has(row.id));
  // A replay that adds nothing leaves the published rollups as they are.
  if (!added.length) return false;
  const evaluationIds = [...known, ...added.map((row) => row.id)];
  const issues = await snapshotIssues(db, crawl, evaluationIds);
  await db
    .updateTable('site_health_snapshots')
    .set({ ...issueColumns(issues), source_evaluation_ids: evaluationIds })
    .where('id', '=', snapshot.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
  await db
    .updateTable('site_crawls')
    .set({
      score_summary: sql`jsonb_set(score_summary, '{issue_count}', to_jsonb(${issues.issue_count}::int))`,
    })
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .where('score_summary', 'is not', null)
    .execute();
  return true;
}

export async function refreshLiveScoreSummary(db: Database, crawl: Crawl) {
  const projection = await loadMeasurementProjection(db, crawl);
  if (!projection.rows.length) return;
  const issues = await snapshotIssues(
    db,
    crawl,
    projection.evaluations.map((row) => row.id),
  );
  const payload = scoreSummary(projection, issues.issue_count);
  if (!reads.terminal_crawl_statuses.includes(crawl.status)) {
    for (const row of [payload, ...Object.values(payload.by_page_kind)]) {
      row.web_fundamentals_state = 'limited_evidence';
      row.aeo_measurement_state = 'limited_evidence';
    }
  }
  await db
    .updateTable('site_crawls')
    .set({ score_summary: JSON.stringify(payload) })
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
}
