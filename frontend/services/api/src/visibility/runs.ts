import { sql } from 'kysely';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { modelProvenanceFor, type ModelProvenance } from '../analysis/provenance.ts';
import {
  askedWholeSet,
  auditFrozenRetrievalEnabled,
  readFrozenConfiguration,
} from '../audits/frozen-configuration.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { storedInstant, timestamptz, utcTextOf } from '../db/timestamps.ts';
import type { ParsedDatetime } from '../http/datetimes.ts';
import { onlyOf } from '../lists.ts';
import type { RunSelection } from './selection.ts';
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
  snapshotCreatedAt: string;
  configuration: unknown;
  completedAt: string;
  provenance: ModelProvenance[];
};

export type RunScope = {
  workspaceId: string;
  projectId: string;
  marketId?: string | null;
  topicId?: string | null;
};
export const marketOf = (scope: { marketId?: string | null }) => scope.marketId ?? null;

export type Instant = ParsedDatetime | string;

function instantOperand(value: Instant) {
  return typeof value === 'string' ? storedInstant(value) : timestamptz(value);
}

export async function loadMeasuredRuns(
  db: Database,
  scope: RunScope,
  window: {
    fromAt: Instant | null;
    toAt: Instant | null;
    newest?: number;
    olderThan?: string;
    newerThan?: string;
    oldest?: number;
    auditId?: string;
  },
): Promise<MeasuredRun[]> {
  const topicId = scope.topicId ?? null;
  const measured = (column: string) => sql.ref(`${topicId ? 'topic' : 'snapshot'}.${column}`);
  let query = db
    .selectFrom('metric_snapshots as snapshot')
    .innerJoin('audits as audit', 'audit.id', 'snapshot.audit_id')
    .leftJoin('audit_topic_metrics as topic', (join) =>
      join
        .onRef('topic.audit_id', '=', 'audit.id')
        .on('topic.workspace_id', '=', scope.workspaceId)
        .on(sql<boolean>`topic.topic_id = ${topicId}`),
    )
    .select([
      sql<string>`${measured('id')}`.as('snapshot_id'),
      'snapshot.audit_id',
      'snapshot.analyzer_version',
      'snapshot.scoring_rule_version',
      sql<number>`${measured('visibility_score')}`.as('visibility_score'),
      sql<unknown>`${measured('metrics')}`.as('metrics'),
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
  if (topicId) query = query.where('topic.id', 'is not', null);
  if (window.auditId !== undefined) query = query.where('audit.id', '=', window.auditId);
  if (window.fromAt) query = query.where('audit.completed_at', '>=', instantOperand(window.fromAt));
  if (window.toAt) query = query.where('audit.completed_at', '<=', instantOperand(window.toAt));
  if (window.olderThan !== undefined)
    query = query.where(
      sql<boolean>`(audit.completed_at, audit.created_at, audit.id) < (select a.completed_at, a.created_at, a.id from audits a where a.id = ${window.olderThan} and a.workspace_id = ${scope.workspaceId})`,
    );
  if (window.newerThan !== undefined)
    query = query.where(
      sql<boolean>`(audit.completed_at, audit.created_at, audit.id) > (select a.completed_at, a.created_at, a.id from audits a where a.id = ${window.newerThan} and a.workspace_id = ${scope.workspaceId})`,
    );
  const newestFirst = window.newest !== undefined;
  const direction = newestFirst ? 'desc' : 'asc';
  query = query
    .orderBy('audit.completed_at', direction)
    .orderBy('audit.created_at', direction)
    .orderBy('audit.id', direction);
  if (newestFirst) query = query.limit(window.newest!);
  else if (window.oldest !== undefined) query = query.limit(window.oldest);
  const rows = await query.execute();
  if (newestFirst) rows.reverse();
  const routes = await engineSnapshots(
    db,
    scope.workspaceId,
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

export async function periodTrendSelection(
  db: Database,
  selection: RunSelection,
): Promise<RunSelection | null> {
  const [pooled] = selection.auditIds ?? [];
  if (pooled === undefined || (selection.fromAt === null && selection.toAt === null)) return null;
  const run = await db
    .selectFrom('audits')
    .select('market_id')
    .where('workspace_id', '=', selection.workspaceId)
    .where('id', '=', pooled)
    .executeTakeFirstOrThrow();
  const runs = await loadMeasuredRuns(
    db,
    { ...selection, marketId: run.market_id },
    { fromAt: selection.fromAt, toAt: selection.toAt, newest: visibility.selection_max_runs },
  );
  if (runs.length === 0) return null;
  const auditIds = runs.map((measured) => measured.auditId);
  return { ...selection, auditId: null, auditIds, fromAt: null, toAt: null };
}

export async function engineSnapshots(
  db: Database,
  workspaceId: string,
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
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', 'in', [...new Set(auditIds)])
    .execute();
  for (const row of rows) {
    const list = routes.get(row.audit_id) ?? [];
    list.push(row);
    routes.set(row.audit_id, list);
  }
  return routes;
}

export function selectedScore(
  storedScore: number,
  metrics: Metrics,
  cohort: string,
  engine: string | null,
): number | null {
  if (!metricNumber(metrics.total_completed)) return null;
  return cohort === visibility.core_cohort && engine === null ? storedScore : null;
}

export type TrendSource = {
  snapshotId: string;
  auditId: string;
  completedAt: string;
  logicalEngine: string | null;
  transportModel: string | null;
  retrievalEnabled: boolean;
  modelProvenance: ModelProvenance[];
  panelHash: string | null;
  wholeSet: boolean;
  analyzerVersion: string;
  scoringRuleVersion: string;
  totalCompleted: number;
  visibilityScore: number | null;
  metrics: Metrics;
  comparisonKey: string | null;
  promptPerformanceScore: number | null;
};

function sourceModel(provenance: readonly ModelProvenance[], engine: string | null): string | null {
  if (engine !== null) {
    return provenance.find((item) => item.logical_engine === engine)?.transport_model ?? null;
  }
  const models = new Set(provenance.map((item) => item.transport_model));
  return onlyOf(models) ?? null;
}

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
    panelHash: readFrozenConfiguration(run.configuration).panel_hash ?? null,
    wholeSet: askedWholeSet(run.configuration),
    analyzerVersion: run.analyzerVersion,
    scoringRuleVersion: run.scoringRuleVersion,
    totalCompleted: metricCount(metrics.total_completed),
    visibilityScore: selectedScore(run.visibilityScore, metrics, cohort, engine),
    metrics,
    comparisonKey: frozenComparisonKey(run.configuration, engine),
    promptPerformanceScore: promptPerformance(metrics),
  };
}
