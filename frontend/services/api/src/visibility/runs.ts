/**
 * A project's measured runs: each dashboard-ready brand run with its
 * persisted `MetricSnapshot` and frozen routes.
 *
 * Every trend, range and baseline read walks
 * this one list. A source's folding identity comes only from frozen audit
 * fields, never from live configuration.
 */
import { sql } from 'kysely';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import {
  auditFrozenRetrievalEnabled,
  modelProvenanceFor,
  type ModelProvenance,
} from '../analysis/provenance.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { storedInstant, timestamptz, utcTextOf } from '../db/timestamps.ts';
import type { ParsedDatetime } from '../http/datetimes.ts';
import { onlyOf } from '../lists.ts';
import {
  cohortMetrics,
  engineMetrics,
  metricCount,
  metricNumber,
  promptPerformance,
  type Metrics,
} from './metrics.ts';

const visibility = policy.visibility;

export type MeasuredRun = {
  snapshotId: string;
  auditId: string;
  auditStatus: string;
  analyzerVersion: string;
  scoringRuleVersion: string;
  visibilityScore: number;
  metrics: unknown;
  /** UTC text with microseconds (`utcText`): it orders as it compares. */
  snapshotCreatedAt: string;
  configuration: unknown;
  completedAt: string;
  provenance: ModelProvenance[];
};

/**
 * A project's runs in one measurement market. Markets never mix in a
 * projection: an omitted or `null` market is the project default.
 */
export type RunScope = { workspaceId: string; projectId: string; marketId?: string | null };
export const marketOf = (scope: { marketId?: string | null }) => scope.marketId ?? null;

/** A request timestamp, or a stored one read back as `utcText`. */
export type Instant = ParsedDatetime | string;

function instantOperand(value: Instant) {
  return typeof value === 'string' ? storedInstant(value) : timestamptz(value);
}

/**
 * The project's measured runs completed inside the inclusive window, oldest
 * first. `newest` bounds the read to that many most recent runs: a caller
 * walking back to the nearest match needs the recent end, not a project's
 * whole history on every dashboard load.
 */
export async function loadMeasuredRuns(
  db: Database,
  scope: RunScope,
  window: { fromAt: Instant | null; toAt: Instant | null; newest?: number },
): Promise<MeasuredRun[]> {
  let query = db
    .selectFrom('metric_snapshots as snapshot')
    .innerJoin('audits as audit', 'audit.id', 'snapshot.audit_id')
    .select([
      'snapshot.id as snapshot_id',
      'snapshot.audit_id',
      'snapshot.analyzer_version',
      'snapshot.scoring_rule_version',
      'snapshot.visibility_score',
      'snapshot.metrics',
      utcTextOf(sql.ref('snapshot.created_at')).as('snapshot_created_at'),
      'audit.status',
      'audit.configuration',
      utcTextOf(sql.ref('audit.completed_at')).as('completed_at'),
    ])
    .where('snapshot.workspace_id', '=', scope.workspaceId)
    .where('snapshot.project_id', '=', scope.projectId)
    .where('audit.workspace_id', '=', scope.workspaceId)
    .where('audit.project_id', '=', scope.projectId)
    .where('audit.market_id', 'is not distinct from', marketOf(scope))
    .where('audit.audit_scope', '=', visibility.brand_audit_scope)
    .where('audit.status', 'in', visibility.dashboard_audit_statuses)
    .where('audit.completed_at', 'is not', null);
  if (window.fromAt) query = query.where('audit.completed_at', '>=', instantOperand(window.fromAt));
  if (window.toAt) query = query.where('audit.completed_at', '<=', instantOperand(window.toAt));
  const newestFirst = window.newest !== undefined;
  const direction = newestFirst ? 'desc' : 'asc';
  query = query
    .orderBy('audit.completed_at', direction)
    .orderBy('audit.created_at', direction)
    .orderBy('audit.id', direction);
  if (newestFirst) query = query.limit(window.newest!);
  const rows = await query.execute();
  if (newestFirst) rows.reverse();
  const routes = await engineSnapshots(
    db,
    rows.map((row) => row.audit_id),
  );
  return rows.map((row) => ({
    snapshotId: row.snapshot_id,
    auditId: row.audit_id,
    auditStatus: row.status,
    analyzerVersion: row.analyzer_version,
    scoringRuleVersion: row.scoring_rule_version,
    visibilityScore: row.visibility_score,
    metrics: row.metrics,
    snapshotCreatedAt: row.snapshot_created_at,
    configuration: row.configuration,
    completedAt: row.completed_at,
    provenance: modelProvenanceFor(routes.get(row.audit_id) ?? [], row.configuration),
  }));
}

/** Each run's frozen engine routes; the runs are already authorized. */
export async function engineSnapshots(
  db: Database,
  auditIds: readonly string[],
): Promise<
  Map<string, { logical_engine: string; transport_provider: string; transport_model: string }[]>
> {
  const routes = new Map<
    string,
    { logical_engine: string; transport_provider: string; transport_model: string }[]
  >();
  if (auditIds.length === 0) return routes;
  const rows = await db
    .selectFrom('audit_engine_snapshots')
    .select(['audit_id', 'logical_engine', 'transport_provider', 'transport_model'])
    .where('audit_id', 'in', [...new Set(auditIds)])
    .execute();
  for (const row of rows) {
    const list = routes.get(row.audit_id) ?? [];
    list.push(row);
    routes.set(row.audit_id, list);
  }
  return routes;
}

/**
 * The persisted composite for this selection, or nothing. Only the core
 * cohort across every engine stores one; a slice has no composite, and the
 * prompt composite is a different measure that must not stand in for it.
 */
export function selectedScore(
  storedScore: number,
  metrics: Metrics,
  cohort: string,
  engine: string | null,
): number | null {
  if (!metricNumber(metrics.total_completed)) return null;
  return cohort === visibility.core_cohort && engine === null ? storedScore : null;
}

/** One measured run projected for folding: a trend point, a range or a baseline. */
export type TrendSource = {
  snapshotId: string;
  auditId: string;
  completedAt: string;
  logicalEngine: string | null;
  transportModel: string | null;
  retrievalEnabled: boolean | null;
  modelProvenance: ModelProvenance[];
  analyzerVersion: string;
  scoringRuleVersion: string;
  totalCompleted: number;
  visibilityScore: number | null;
  metrics: Metrics;
  comparisonKey: string | null;
  promptPerformanceScore: number | null;
};

/** The singular frozen model, or null when the source spans several. */
function sourceModel(provenance: readonly ModelProvenance[], engine: string | null): string | null {
  if (engine !== null) {
    return provenance.find((item) => item.logical_engine === engine)?.transport_model ?? null;
  }
  const models = new Set(provenance.map((item) => item.transport_model));
  return onlyOf(models) ?? null;
}

/**
 * One run as a folding source, or null when an engine-filtered request asks
 * for an engine the run did not measure: a missing engine emits no point.
 */
export function trendSource(
  run: MeasuredRun,
  engine: string | null,
  cohort: string,
): TrendSource | null {
  const cohortAggregate = cohortMetrics(run.metrics, cohort);
  const metrics = engine === null ? cohortAggregate : engineMetrics(cohortAggregate, engine);
  if (engine !== null && Object.keys(metrics).length === 0) return null;
  return {
    snapshotId: run.snapshotId,
    auditId: run.auditId,
    completedAt: run.completedAt,
    logicalEngine: engine,
    transportModel: sourceModel(run.provenance, engine),
    retrievalEnabled: auditFrozenRetrievalEnabled(run.configuration),
    modelProvenance: run.provenance,
    analyzerVersion: run.analyzerVersion,
    scoringRuleVersion: run.scoringRuleVersion,
    totalCompleted: metricCount(metrics.total_completed),
    visibilityScore: selectedScore(run.visibilityScore, metrics, cohort, engine),
    metrics,
    comparisonKey: frozenComparisonKey(run.configuration, engine),
    // The preserved prompt composite: a different measure from the score.
    promptPerformanceScore: promptPerformance(metrics),
  };
}
