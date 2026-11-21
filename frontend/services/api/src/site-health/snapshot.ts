import { randomUUID } from 'node:crypto';
import { isActiveCrawl, USABLE_CRAWL_STATUSES } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { numberRecord } from '../db/json.ts';
import { sameScope } from './change-snapshot.ts';
import { cohortComposition } from './cohort-composition.ts';
import { crawlCoverage } from './coverage.ts';
import {
  lockProfile,
  measurementProjection,
  scoreSummary,
  type MeasurementProjection,
} from './score-summary.ts';
import { liveScoreSummary } from './live-score.ts';
import { isPageRerun, pageRerunSql } from './page-rerun.ts';
import { snapshotIssues } from './snapshot-issues.ts';
import { CRAWL_COLUMNS, type Crawl } from './site-task.ts';

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

async function pageColumns(db: Database, crawl: Crawl, projection: MeasurementProjection) {
  const issues = await snapshotIssues(db, crawl, projection.analysisIds);
  const eligibility = projection.eligibility;
  const {
    readiness_dimensions: dimensions,
    scoring_version: _scoring,
    ...aggregate
  } = projection.aggregate;
  return {
    issues,
    eligibility,
    columns: {
      selected_url_count: projection.selectedCount,
      ...aggregate,
      ...projection.classification,
      classification_reason_groups: JSON.stringify(
        projection.classification.classification_reason_groups,
      ),
      scored_page_count_by_kind: JSON.stringify(
        projection.classification.scored_page_count_by_kind,
      ),
      readiness_dimensions: JSON.stringify(dimensions),
      aeo_readiness_diagnostic: JSON.stringify(projection.readinessDiagnostic),
      ...eligibility,
      eligibility_totals: JSON.stringify(eligibility.eligibility_totals),
      eligibility_reasons: JSON.stringify(eligibility.eligibility_reasons),
      status_counts: JSON.stringify(eligibility.status_counts),
      ...issueColumns(issues),
      web_fundamentals: JSON.stringify(projection.webDiagnostic),
      change_summary: JSON.stringify(await changeSummary(db, crawl, projection)),
      source_artifact_ids: projection.artifactIds,
    },
  };
}

/** Rows per statement, far under PostgreSQL's 65535 bind parameters. */
const ANALYSIS_ROW_CHUNK = 5000;

async function writeAnalysisSet(
  db: Database,
  snapshot: { id: string; workspace_id: string },
  projection: MeasurementProjection,
) {
  await db
    .deleteFrom('site_health_snapshot_analyses')
    .where('workspace_id', '=', snapshot.workspace_id)
    .where('snapshot_id', '=', snapshot.id)
    .execute();
  const rows = [...new Set(projection.analysisIds)].map((analysisId) => ({
    workspace_id: snapshot.workspace_id,
    snapshot_id: snapshot.id,
    analysis_id: analysisId,
  }));
  for (let offset = 0; offset < rows.length; offset += ANALYSIS_ROW_CHUNK)
    await db // NOSONAR -- In order, in the caller's one publication transaction.
      .insertInto('site_health_snapshot_analyses')
      .values(rows.slice(offset, offset + ANALYSIS_ROW_CHUNK))
      .execute();
}

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

export async function persistCrawlSnapshot(db: Database, crawl: Crawl, persistEmpty = false) {
  if (isPageRerun(crawl)) return false;
  await lockProfile(db, crawl);
  const projection = await measurementProjection(db, crawl);
  if (
    !persistEmpty &&
    !projection.analysisIds.length &&
    !projection.classification.classification_expected_page_count
  )
    return false;
  const now = new Date();
  const published = await pageColumns(db, crawl, projection);
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
      coverage_evidence: JSON.stringify({ ...coverage.evidence, ...projection.checkCounts }),
      coverage_formula_version: reads.coverage_formula_version,
      analyzer_version: crawl.analyzer_version || policy.site_health.versions.analyzer,
      scoring_version: crawl.scoring_version || reads.scoring_version,
      profile_version: versions.profile,
      schema_contract_version: versions.schema_contract,
      presentation_version: versions.presentation,
      created_at: now,
    })
    .onConflict((conflict) => conflict.constraint('uq_site_health_snapshot_crawl').doNothing())
    .returning(['id', 'workspace_id'])
    .executeTakeFirst();
  if (!inserted) return false;
  await writeAnalysisSet(db, inserted, projection);
  await publishScoreSummary(db, crawl, projection, published);
  return true;
}

export async function refreshSiteSnapshot(db: Database, crawl: Crawl) {
  if (isPageRerun(crawl)) return false;
  const snapshot = await db
    .selectFrom('site_health_snapshots')
    .select(['id', 'workspace_id', 'created_at'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .forUpdate()
    .executeTakeFirst();
  if (!snapshot) return false;
  await lockProfile(db, crawl);
  const projection = await measurementProjection(db, crawl);
  const published = await pageColumns(db, crawl, projection);
  await writeAnalysisSet(db, snapshot, projection);
  await db
    .updateTable('site_health_snapshots')
    .set({
      ...published.columns,
      coverage_evidence: sql`coverage_evidence || ${JSON.stringify(projection.checkCounts)}::jsonb`,
    })
    .where('id', '=', snapshot.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
  await publishScoreSummary(db, crawl, projection, published);
  return true;
}

function issueColumns(issues: Awaited<ReturnType<typeof snapshotIssues>>) {
  return {
    ...issues,
    top_issues: JSON.stringify(issues.top_issues),
    severity_counts: JSON.stringify(issues.severity_counts),
    category_counts: JSON.stringify(issues.category_counts),
  };
}

export async function addArchitectureIssues(db: Database, crawl: Crawl) {
  const snapshot = await db
    .selectFrom('site_health_snapshots')
    .select(['id', 'issue_count', 'technical_defect_count', 'aeo_readiness_gap_count'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .forUpdate()
    .executeTakeFirst();
  if (!snapshot) return false;
  const analyses = await db
    .selectFrom('site_health_snapshot_analyses')
    .select('analysis_id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('snapshot_id', '=', snapshot.id)
    .execute();
  const issues = await snapshotIssues(
    db,
    crawl,
    analyses.map((row) => row.analysis_id),
  );
  if (
    issues.issue_count === snapshot.issue_count &&
    issues.technical_defect_count === snapshot.technical_defect_count &&
    issues.aeo_readiness_gap_count === snapshot.aeo_readiness_gap_count
  )
    return false;
  await db
    .updateTable('site_health_snapshots')
    .set(issueColumns(issues))
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

export async function provisionalSummary(db: Database, crawl: Crawl) {
  return isPageRerun(crawl) ? null : liveScoreSummary(db, crawl);
}

export type LiveSummary = NonNullable<Awaited<ReturnType<typeof liveScoreSummary>>>;
export function writeScoreSummary(db: Database, crawl: Crawl, payload: LiveSummary) {
  return db
    .updateTable('site_crawls')
    .set({ score_summary: JSON.stringify(payload) })
    .where('id', '=', crawl.id)
    .where('workspace_id', '=', crawl.workspace_id)
    .execute();
}

export async function refreshLiveScoreSummary(db: Database, crawl: Crawl) {
  const payload = await provisionalSummary(db, crawl);
  if (payload) await writeScoreSummary(db, crawl, payload);
}

export async function refreshRunningScoreSummary(
  db: Database,
  task: { workspace_id: string; crawl_id: string },
) {
  const crawl = await db
    .selectFrom('site_crawls')
    .select(CRAWL_COLUMNS)
    .where('workspace_id', '=', task.workspace_id)
    .where('id', '=', task.crawl_id)
    .executeTakeFirst();
  if (!crawl || !isActiveCrawl(crawl.status)) return;
  const payload = await provisionalSummary(db, crawl);
  if (!payload) return;
  await db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('site_crawls')
      .select('status')
      .where('workspace_id', '=', crawl.workspace_id)
      .where('id', '=', crawl.id)
      .forNoKeyUpdate()
      .executeTakeFirst();
    if (locked && isActiveCrawl(locked.status)) await writeScoreSummary(trx, crawl, payload);
  });
}
