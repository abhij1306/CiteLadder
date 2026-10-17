/**
 * The selected-measurement visibility dashboard: one run, or one frozen
 * configuration pooled across a period.
 *
 * Computed from the persisted `MetricSnapshot`; no
 * cross-run trend here (that is `/visibility/trends`). The latest run is the
 * default selection, and a range pools only runs of one configuration.
 */
import { auditStatusSchema } from '@citeladder/contracts/audits';
import type { visibilitySchema } from '@citeladder/contracts/visibility';
import { sql } from 'kysely';
import type { z } from 'zod';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { modelProvenanceFor } from '../analysis/provenance.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { wireUtc, wireUtcOf, utcText, utcTextOf } from '../db/timestamps.ts';
import { epochMicros, fromEpochMicros, toUtc, type ParsedDatetime } from '../http/datetimes.ts';
import { compareText } from '../text-order.ts';
import { groupBy, isNonEmpty, lastOf, type NonEmpty } from '../lists.ts';
import {
  applyRankingComparison,
  compareSelection,
  competitorGaps,
  emptyComparison,
  type VisibilityComparison,
} from './comparison.ts';
import {
  cohortMetrics,
  engineMetrics,
  isComplete,
  measurementCounts,
  metricCount,
  metricNumber,
  metricObject,
  observedRate,
  promptPerformance,
  rankingRows,
  type MeasurementCounts,
  type Metrics,
  type RankingRow,
} from './metrics.ts';
import { applyMarks, rankingMarks } from './ranking-marks.ts';
import {
  engineSnapshots,
  loadMeasuredRuns,
  marketOf,
  selectedScore,
  trendSource,
  type MeasuredRun,
  type RunScope,
  type TrendSource,
} from './runs.ts';
import {
  AnalysisNotFoundError,
  authorizedSelection,
  TrendQueryError,
  validateCohort,
  validateEngineAndRange,
  type RunSelection,
} from './selection.ts';
import { foldBucket, type TrendPoint } from './trend-folding.ts';

const visibility = policy.visibility;

export type VisibilityResponse = z.input<typeof visibilitySchema>;
type EngineRow = VisibilityResponse['per_engine'][number];

export type DashboardQuery = {
  auditId: string | null;
  logicalEngine: string | null;
  baselineId: string | null;
  selectionMode: 'latest' | 'run' | 'range';
  fromAt: ParsedDatetime | null;
  toAt: ParsedDatetime | null;
  configurationKey: string | null;
  cohort: string;
};

export async function getVisibility(
  db: Database,
  requested: RunScope,
  query: DashboardQuery,
): Promise<VisibilityResponse> {
  validateEngineAndRange(query);
  validateCohort(query.cohort);
  if (query.selectionMode === 'run' && query.auditId === null) {
    throw new TrendQueryError('A specific run selection requires audit_id');
  }
  if (query.selectionMode === 'range') return rangeVisibility(db, requested, query);
  const run = await selectedRun(db, requested, query.auditId);
  // A named run is read in its own market: comparisons stay inside it.
  const scope = { ...requested, marketId: run.marketId };
  const view = await runView(db, scope, run, query);
  const comparison = await compareSelection(
    db,
    scope,
    {
      auditId: run.auditId,
      workspaceId: scope.workspaceId,
      configuration: run.configuration,
      completedAt: run.completedAt,
      analyzerVersion: run.analyzerVersion,
      scoringRuleVersion: run.scoringRuleVersion,
      metrics: view.metrics,
    },
    { cohort: query.cohort, engine: query.logicalEngine, baselineId: query.baselineId },
  );
  const gaps = await competitorGaps(db, {
    workspaceId: scope.workspaceId,
    auditIds: [run.auditId],
    cohort: query.cohort,
    engine: query.logicalEngine,
  });
  applyRankingComparison(view.response.rankings, comparison, gaps);
  return { ...view.response, comparison };
}

/** One run's projection with no baseline comparison, for summary surfaces such as Overview. */
export async function getRunVisibility(
  db: Database,
  scope: RunScope,
  auditId: string,
  cohort: string,
): Promise<VisibilityResponse & { rankings: RankingRow[] }> {
  validateCohort(cohort);
  const run = await selectedRun(db, scope, auditId);
  return (await runView(db, scope, run, { auditId, logicalEngine: null, cohort })).response;
}

type SelectedRun = Omit<MeasuredRun, 'completedAt'> & { completedAt: string | null };

const brandRuns = (db: Database, scope: RunScope) =>
  db
    .selectFrom('audits')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('audit_scope', '=', visibility.brand_audit_scope);

/** The latest dashboard-ready brand run: what "Latest" means on every visibility read. */
async function latestDashboardRunId(db: Database, scope: RunScope): Promise<string> {
  const latest = await brandRuns(db, scope)
    .select('id')
    .where('market_id', 'is not distinct from', marketOf(scope))
    .where('status', 'in', visibility.dashboard_audit_statuses)
    .orderBy(sql`completed_at desc nulls last`)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (latest === undefined) throw new AnalysisNotFoundError('No completed audit for project');
  return latest.id;
}

/** The runs an evidence summary covers: the selection, or the latest dashboard-ready run. */
export async function scopedSelection(
  db: Database,
  selection: RunSelection,
): Promise<RunSelection> {
  const scoped = await authorizedSelection(db, selection);
  if (scoped.auditId || scoped.auditIds?.length || scoped.fromAt || scoped.toAt) return scoped;
  return { ...scoped, auditId: await latestDashboardRunId(db, scoped) };
}

/** The named run, or the latest dashboard-ready one; its snapshot must exist. */
async function selectedRun(
  db: Database,
  scope: RunScope,
  auditId: string | null,
): Promise<SelectedRun & { marketId: string | null }> {
  const selectedId = auditId ?? (await latestDashboardRunId(db, scope));
  const audit = await brandRuns(db, scope)
    .select([
      'id',
      'status',
      'configuration',
      'market_id',
      utcText(sql.ref('completed_at')).as('completed_at'),
    ])
    .where('id', '=', selectedId)
    .executeTakeFirst();
  if (audit === undefined) throw new AnalysisNotFoundError('Audit not found');
  const snapshot = await db
    .selectFrom('metric_snapshots')
    .select([
      'id',
      'analyzer_version',
      'scoring_rule_version',
      'visibility_score',
      'metrics',
      utcTextOf(sql.ref('created_at')).as('created_at'),
    ])
    .where('audit_id', '=', audit.id)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (snapshot === undefined) throw new AnalysisNotFoundError('Metrics not available for audit');
  const routes = await engineSnapshots(db, [audit.id]);
  return {
    snapshotId: snapshot.id,
    auditId: audit.id,
    auditStatus: audit.status,
    analyzerVersion: snapshot.analyzer_version,
    scoringRuleVersion: snapshot.scoring_rule_version,
    visibilityScore: snapshot.visibility_score,
    metrics: snapshot.metrics,
    snapshotCreatedAt: snapshot.created_at,
    configuration: audit.configuration,
    completedAt: audit.completed_at,
    marketId: audit.market_id,
    provenance: modelProvenanceFor(routes.get(audit.id) ?? [], audit.configuration),
  };
}

function engineRow(engine: string, metrics: Metrics): EngineRow {
  return {
    logical_engine: engine,
    total_completed: metricCount(metrics.total_completed),
    brand_mention_rate: observedRate(metrics, 'brand_mention_rate'),
    owned_citation_rate: observedRate(metrics, 'owned_citation_rate'),
    counts: measurementCounts(metrics),
    search_use_rate: metricNumber(metrics.search_use_rate),
    visibility_score: promptPerformance(metrics),
  };
}

function engineRows(metrics: Metrics): EngineRow[] {
  return Object.entries(metricObject(metrics.per_engine))
    .sort(([left], [right]) => compareText(left, right))
    .map(([engine, aggregate]) => engineRow(engine, metricObject(aggregate)));
}

function citationTotals(metrics: Metrics): NonNullable<VisibilityResponse['citation_totals']> {
  const totals = metricObject(metrics.citation_totals);
  return {
    citations: metricCount(totals.citations),
    owned_citations: metricCount(totals.owned_citations),
    owned_share: metricNumber(totals.owned_share),
  };
}

/** One run's projection before any comparison is applied. */
async function runView(
  db: Database,
  scope: RunScope,
  run: SelectedRun,
  query: Pick<DashboardQuery, 'auditId' | 'logicalEngine' | 'cohort'>,
): Promise<{ metrics: Metrics; response: VisibilityResponse & { rankings: RankingRow[] } }> {
  const cohort = cohortMetrics(run.metrics, query.cohort);
  const engine = query.logicalEngine;
  const metrics = engine === null ? cohort : engineMetrics(cohort, engine);
  const rankings = rankingRows(metrics);
  applyMarks(rankings, await rankingMarks(db, scope.projectId));
  const counts = measurementCounts(metrics);
  return {
    metrics,
    response: {
      project_id: scope.projectId,
      audit_id: run.auditId,
      audit_status: auditStatusSchema.parse(run.auditStatus),
      selection_mode: query.auditId ? 'run' : 'latest',
      source_audit_ids: [run.auditId],
      configuration_groups: {},
      from_at: null,
      to_at: null,
      analyzer_version: run.analyzerVersion,
      scoring_rule_version: run.scoringRuleVersion,
      cohort: query.cohort as VisibilityResponse['cohort'],
      coverage: Object.fromEntries(
        Object.entries(metricObject(metrics.coverage)).map(([key, value]) => [
          key,
          metricNumber(value),
        ]),
      ),
      total_completed: counts.responses,
      total_failed: counts.failed ?? 0,
      visibility_score: selectedScore(run.visibilityScore, metrics, query.cohort, engine),
      visibility_rate: observedRate(metrics, 'brand_mention_rate'),
      owned_citation_rate: observedRate(metrics, 'owned_citation_rate'),
      // The preserved prompt composite: a different measure from the score.
      prompt_performance_score: promptPerformance(metrics),
      counts,
      comparison_key: frozenComparisonKey(run.configuration, engine),
      comparison: emptyComparison(),
      model_provenance: run.provenance,
      rankings,
      per_engine: engine === null ? engineRows(metrics) : [engineRow(engine, metrics)],
      avg_position: metricNumber(metrics.avg_position),
      citation_totals: citationTotals(metrics),
      created_at: wireUtc(run.snapshotCreatedAt),
    },
  };
}

// --- Range: one frozen configuration pooled across an explicit period -----

/** A configuration is its identity plus the versions that computed it. */
function configurationGroup(source: TrendSource): string {
  return `${source.comparisonKey || source.auditId}:${source.analyzerVersion}:${source.scoringRuleVersion}`;
}

function rangeGroups(
  runs: readonly MeasuredRun[],
  query: DashboardQuery,
): {
  groups: Map<string, NonEmpty<TrendSource>>;
  key: string;
  sources: NonEmpty<TrendSource>;
} {
  const groups = groupBy(
    runs
      .map((run) => trendSource(run, query.logicalEngine, query.cohort))
      .filter((source) => source !== null),
    configurationGroup,
  );
  if (groups.size === 0) throw new AnalysisNotFoundError('No measurements in the selected period');
  // The configuration measured most recently, unless the reader chose one.
  let key = query.configurationKey;
  if (key === null) {
    let latest: TrendSource | null = null;
    for (const [group, sources] of groups) {
      const last = lastOf(sources);
      if (latest === null || last.completedAt > latest.completedAt) {
        key = group;
        latest = last;
      }
    }
  }
  const sources = groups.get(key!);
  if (sources === undefined) {
    throw new TrendQueryError('Configuration is not present in the selected period');
  }
  if (sources.length > visibility.selection_max_runs) {
    throw new TrendQueryError(
      `Select a narrower period: at most ${visibility.selection_max_runs} runs per selection`,
    );
  }
  return { groups, key: key!, sources };
}

/** Per-engine rows over the selected runs; a configured engine never answered is unavailable. */
function rangeEngines(
  runs: readonly MeasuredRun[],
  sources: readonly TrendSource[],
  query: DashboardQuery,
): EngineRow[] {
  const selected = new Set(sources.map((source) => source.auditId));
  const engines = [
    ...new Set(
      sources.flatMap((source) => source.modelProvenance.map((item) => item.logical_engine)),
    ),
  ].sort(compareText);
  return engines
    .filter((engine) => query.logicalEngine === null || engine === query.logicalEngine)
    .map((engine) => {
      const engineSources = runs
        .filter((run) => selected.has(run.auditId))
        .map((run) => trendSource(run, engine, query.cohort))
        .filter((source) => source !== null);
      if (!isNonEmpty(engineSources)) {
        return {
          logical_engine: engine,
          total_completed: 0,
          brand_mention_rate: null,
          owned_citation_rate: null,
          search_use_rate: null,
          visibility_score: null,
          counts: unavailableCounts(),
        };
      }
      const point = foldBucket(lastOf(engineSources).completedAt, engineSources);
      return {
        logical_engine: engine,
        total_completed: point.counts!.responses,
        counts: point.counts,
        brand_mention_rate: point.visibility_rate ?? null,
        owned_citation_rate: point.owned_citation_rate,
        search_use_rate: null,
        visibility_score: null,
      };
    });
}

function unavailableCounts(): MeasurementCounts {
  return {
    state: 'unavailable',
    responses: 0,
    brand_responses: null,
    owned_citation_responses: null,
    entity_presences: null,
    expected: null,
    failed: null,
    not_run: null,
  };
}

/** The same configuration over the equally long period just before this one. */
async function comparePeriod(
  db: Database,
  scope: RunScope,
  sources: NonEmpty<TrendSource>,
  point: TrendPoint,
  query: DashboardQuery,
  window: { fromAt: ParsedDatetime; toAt: ParsedDatetime },
): Promise<VisibilityComparison> {
  const reference = sources[0];
  if (!reference.comparisonKey) return emptyComparison();
  const from = epochMicros(window.fromAt);
  const baselineStart = fromEpochMicros(from - (epochMicros(window.toAt) - from));
  const runs = await loadMeasuredRuns(db, scope, {
    fromAt: baselineStart,
    toAt: fromEpochMicros(from - 1n),
  });
  const before = runs
    .map((run) => trendSource(run, query.logicalEngine, query.cohort))
    .filter(
      (source) =>
        source !== null &&
        source.comparisonKey === reference.comparisonKey &&
        source.analyzerVersion === reference.analyzerVersion &&
        source.scoringRuleVersion === reference.scoringRuleVersion,
    ) as TrendSource[];
  if (!isNonEmpty(before)) return emptyComparison();
  const previous = foldBucket(lastOf(before).completedAt, before);
  const result = emptyComparison({
    status: 'comparable',
    baseline_at: wireUtcOf(baselineStart),
    baseline_counts: previous.counts,
    baseline_audit_ids: before.map((source) => source.auditId),
    current_counts: point.counts,
    rankings: previous.rankings.map(asRankingRow),
  });
  if (!(isComplete(previous.counts!) && isComplete(point.counts!))) {
    return { ...result, status: 'partial_coverage' };
  }
  const delta = (after: number | null | undefined, baseline: number | null | undefined) =>
    after != null && baseline != null ? (after - baseline) * 100 : null;
  return {
    ...result,
    deltas: {
      visibility: delta(point.visibility_rate, previous.visibility_rate),
      sov: delta(point.sov.mention, previous.sov.mention),
      owned_citation: delta(point.owned_citation_rate, previous.owned_citation_rate),
    },
  };
}

function asRankingRow(row: TrendPoint['rankings'][number]): RankingRow {
  return {
    visibility_delta: null,
    gap_count: null,
    matched_visibility_rate: null,
    matched_visibility_delta: null,
    matched_response_count: null,
    ...row,
  };
}

async function rangeVisibility(
  db: Database,
  scope: RunScope,
  query: DashboardQuery,
): Promise<VisibilityResponse> {
  const fromAt = query.fromAt && toUtc(query.fromAt);
  const toAt = query.toAt ? toUtc(query.toAt) : fromEpochMicros(BigInt(Date.now()) * 1000n);
  // An open period ends now, so it cannot start later than now.
  if (fromAt && epochMicros(fromAt) > epochMicros(toAt)) {
    throw new TrendQueryError("'from' must not be after 'to'");
  }
  const runs = await loadMeasuredRuns(db, scope, { fromAt, toAt });
  const { groups, key, sources } = rangeGroups(runs, query);
  const latest = lastOf(sources);
  const last = runs.find((run) => run.auditId === latest.auditId)!;
  const { response } = await runView(db, scope, last, { ...query, auditId: last.auditId });
  const point = foldBucket(latest.completedAt, sources);
  const counts = point.counts!;
  const rankings = point.rankings.map(asRankingRow);
  applyMarks(rankings, await rankingMarks(db, scope.projectId));
  const comparison = fromAt
    ? await comparePeriod(db, scope, sources, point, query, { fromAt, toAt })
    : emptyComparison();
  const sourceAuditIds = sources.map((source) => source.auditId);
  const gaps = await competitorGaps(db, {
    workspaceId: scope.workspaceId,
    auditIds: sourceAuditIds,
    cohort: query.cohort,
    engine: query.logicalEngine,
  });
  applyRankingComparison(rankings, comparison, gaps);
  return {
    ...response,
    selection_mode: 'range',
    source_audit_ids: sourceAuditIds,
    configuration_groups: Object.fromEntries(
      [...groups].map(([group, items]) => [group, items.length]),
    ),
    comparison_key: key,
    from_at: fromAt && wireUtcOf(fromAt),
    to_at: wireUtcOf(toAt),
    counts,
    total_completed: counts.responses,
    total_failed: counts.failed ?? 0,
    coverage: {
      requested: counts.expected,
      completed: counts.responses,
      failed: counts.failed,
      not_run: counts.not_run,
      rate: counts.expected ? counts.responses / counts.expected : null,
    },
    visibility_rate: point.visibility_rate ?? null,
    owned_citation_rate: point.owned_citation_rate,
    prompt_performance_score: null,
    visibility_score: null,
    // Pooled like the counts above; the last run's own values would describe one run only.
    avg_position: point.avg_position ?? null,
    model_provenance: point.model_provenance ?? [],
    citation_totals: undefined,
    rankings,
    per_engine: rangeEngines(runs, sources, query),
    comparison,
  };
}
