/** The terminal snapshot and matching crawl summary publish in one transaction. */
import { randomUUID } from 'node:crypto';
import { isTerminalCrawl, USABLE_CRAWL_STATUSES } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { numberRecord } from '../db/json.ts';
import { sameScope } from './change-snapshot.ts';
import { cohortComposition } from './cohort-composition.ts';
import { crawlCoverage } from './coverage.ts';
import {
  loadMeasurementProjection,
  scoreSummary,
  type MeasurementProjection,
} from './score-summary.ts';
import { isPageRerun, pageRerunSql } from './page-rerun.ts';
import { readinessDiagnostic, webDiagnostic } from './snapshot-diagnostics.ts';
import { snapshotEligibility } from './snapshot-eligibility.ts';
import { snapshotIssues } from './snapshot-issues.ts';
import type { Crawl } from './site-task.ts';

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

/**
 * The change since the newest earlier snapshot of a usable, non-empty site crawl
 * under the same versions and scope. A failed or empty crawl, or a page rerun,
 * is never compared; with none left it reports no comparable snapshot.
 */
async function changeSummary(db: Database, crawl: Crawl, projection: MeasurementProjection) {
  const candidates = await db
    .selectFrom('site_health_snapshots as s')
    .innerJoin('site_crawls as c', (join) =>
      join.onRef('c.id', '=', 's.crawl_id').onRef('c.workspace_id', '=', 's.workspace_id'),
    )
    .selectAll('s')
    .select(['c.root_url', 'c.configuration'])
    .where('s.workspace_id', '=', crawl.workspace_id)
    .where('s.project_id', '=', crawl.project_id)
    // Only crawls created before this one, so a late publication never compares
    // with a newer crawl (Changes picks its predecessor the same way).
    .where('c.created_at', '<', crawl.created_at)
    .where('c.status', 'in', USABLE_CRAWL_STATUSES)
    .where('c.analyzed_url_count', '>', 0)
    .where(sql<boolean>`not ${pageRerunSql}`)
    .where(
      's.analyzer_version',
      '=',
      crawl.analyzer_version || policy.site_health.versions.analyzer,
    )
    .where('s.scoring_version', '=', crawl.scoring_version || reads.scoring_version)
    .where('s.profile_version', '=', versions.profile)
    .where('s.schema_contract_version', '=', versions.schema_contract)
    .where('s.presentation_version', '=', versions.presentation)
    .where('s.coverage_formula_version', '=', reads.coverage_formula_version)
    .where('s.classification_formula_version', '=', reads.classification_formula_version)
    .orderBy('c.created_at', 'desc')
    .orderBy('c.id', 'desc')
    // Scope is compared in code, so search as many earlier crawls as Changes does.
    .limit(policy.site_health.change_intel.max_crawl_candidates)
    .execute();
  const previous = candidates.find((row) => sameScope(row, crawl));
  const { changed, composition } = cohortComposition({
    previous: numberRecord(previous?.scored_page_count_by_kind),
    current: projection.classification.scored_page_count_by_kind,
    shareShiftPoints: reads.overview_cohort_share_shift_points,
  });
  return {
    state: previous ? 'measured' : 'unavailable',
    reason: comparisonReason(Boolean(previous), changed),
    cohort_composition: composition,
    metrics: metrics.map(([key, label]) => {
      const before = previous?.[key] ?? null;
      const current = projection.aggregate[key];
      const delta =
        before === null || current === null ? null : Math.round((current - before) * 10000) / 10000;
      return {
        key,
        label,
        previous: before,
        current,
        delta,
        direction: direction(delta),
      };
    }),
  };
}

/** How many scored checks the pages measured, of those they expected. */
function checkCounts(projection: MeasurementProjection) {
  const expected = projection.evaluations.filter(
    (row) => row.score_roles?.length && row.outcome !== 'not_applicable',
  );
  const measured = expected.filter((row) => ['satisfied', 'missing'].includes(row.outcome));
  return { measured_check_count: measured.length, expected_check_count: expected.length };
}

/**
 * Every snapshot column the pages' latest audits decide: scores,
 * classification, eligibility, issue rollups, the change summary and
 * their exact sources. Coverage and discovery stay the crawl's own.
 */
async function pageColumns(
  db: Database,
  crawl: Crawl,
  projection: MeasurementProjection,
  evaluationIds: string[],
) {
  const issues = await snapshotIssues(db, crawl, evaluationIds);
  const eligibility = await snapshotEligibility(db, crawl, projection);
  const {
    readiness_dimensions: dimensions,
    scoring_version: _scoring,
    ...aggregate
  } = projection.aggregate;
  return {
    issues,
    eligibility,
    columns: {
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
      change_summary: JSON.stringify(await changeSummary(db, crawl, projection)),
      source_analysis_ids: projection.rows.map((row) => row.id),
      source_artifact_ids: projection.rows.map((row) => row.artifact_id),
      source_evaluation_ids: evaluationIds,
    },
  };
}

/** The crawl summary a snapshot publishes beside itself. */
async function publishScoreSummary(
  db: Database,
  crawl: Crawl,
  projection: MeasurementProjection,
  published: Pick<Awaited<ReturnType<typeof pageColumns>>, 'issues' | 'eligibility'>,
) {
  await db
    .updateTable('site_crawls')
    .set({
      score_summary: JSON.stringify({
        ...scoreSummary(projection, published.issues.issue_count),
        search_eligibility: published.eligibility.search_eligibility,
      }),
    })
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
}

/**
 * A page rerun re-reads one page: it writes no project snapshot and keeps no
 * site score summary, so it never becomes a compared snapshot or a one-page score.
 * A site crawl's snapshot reads each tracked page's latest audit (SH-B9).
 */
export async function persistCrawlSnapshot(db: Database, crawl: Crawl, persistEmpty = false) {
  if (isPageRerun(crawl)) return false;
  const projection = await loadMeasurementProjection(db, crawl, { latest: true });
  if (
    !persistEmpty &&
    !projection.rows.length &&
    !projection.classification.classification_expected_page_count
  )
    return false;
  const evaluationIds = projection.evaluations.map((row) => row.id);
  const now = new Date();
  const published = await pageColumns(db, crawl, projection, evaluationIds);
  const coverage = await crawlCoverage(db, crawl);
  const inserted = await db
    .insertInto('site_health_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      crawl_id: crawl.id,
      ...published.columns,
      coverage_state: coverage.state,
      coverage_evidence: JSON.stringify({ ...coverage.evidence, ...checkCounts(projection) }),
      coverage_formula_version: reads.coverage_formula_version,
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
  await publishScoreSummary(db, crawl, projection, published);
  return true;
}

/** The architecture evaluations the crawl's snapshot folds in (`addArchitectureIssues`). */
async function architectureEvaluationIds(db: Database, crawl: Crawl) {
  const rows = await db
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
  return rows.map((row) => row.id);
}

/**
 * A page rerun landed in this site crawl (SH-B9): its snapshot's page columns
 * and its score summary are recomputed in place, in the rerun's landing
 * transaction, from each tracked page's latest audit. Coverage and discovery
 * stay the crawl's own; the snapshot keeps its id and time, so the change
 * summary's current values move with the latest audits. A crawl without a
 * snapshot has nothing to refresh.
 */
export async function refreshSiteSnapshot(db: Database, crawl: Crawl) {
  if (isPageRerun(crawl)) return false;
  const snapshot = await db
    .selectFrom('site_health_snapshots')
    .select(['id', 'created_at'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .forUpdate()
    .executeTakeFirst();
  if (!snapshot) return false;
  const projection = await loadMeasurementProjection(db, crawl, { latest: true });
  const own = projection.evaluations.map((row) => row.id);
  const architecture = await architectureEvaluationIds(db, crawl);
  const evaluationIds = [...new Set([...own, ...architecture])];
  const published = await pageColumns(db, crawl, projection, evaluationIds);
  await db
    .updateTable('site_health_snapshots')
    .set({
      ...published.columns,
      coverage_evidence: sql`coverage_evidence || ${JSON.stringify(checkCounts(projection))}::jsonb`,
    })
    .where('id', '=', snapshot.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
  await publishScoreSummary(db, crawl, projection, published);
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
  const architectureEvaluations = (await architectureEvaluationIds(db, crawl)).map((id) => ({
    id,
  }));
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
  if (isPageRerun(crawl)) return;
  // A provisional summary scores the crawl's own analyzed pages (invariant 6).
  const projection = await loadMeasurementProjection(db, crawl, { latest: false });
  if (!projection.rows.length) return;
  const issues = await snapshotIssues(
    db,
    crawl,
    projection.evaluations.map((row) => row.id),
  );
  const payload = scoreSummary(projection, issues.issue_count);
  if (!isTerminalCrawl(crawl.status)) {
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
