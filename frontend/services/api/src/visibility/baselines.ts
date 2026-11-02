/**
 * Each finalized run's comparable baseline, persisted on
 * `audit_comparison_baselines` by audit finalization in its own transaction.
 *
 * One row per requestable cohort and engine selector (every engine the run
 * measured, and all engines together), holding what the comparison walk
 * (`comparison.ts`, the single rule) found: the nearest compatible earlier
 * run in the same market, the comparison status, and the runs passed over.
 * Visibility and Overview both read it, so they name the same baseline, and
 * neither walks the history per request.
 *
 * Two runs of a project can finalize concurrently, so neither sees the other
 * uncommitted. Each finalization therefore takes the project's baseline lock
 * before writing: whichever commits second sees the first. It writes its own
 * rows and then rewrites the rows of runs completed after it that it can
 * reach, so a later run that finalized first still names it.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { utcText } from '../db/timestamps.ts';
import { compareText } from '../text-order.ts';
import { emptyComparison, nearestBaseline, type SelectedRun } from './comparison.ts';
import { cohortMetrics, engineMetrics, metricObject } from './metrics.ts';
import { loadMeasuredRuns, type RunScope } from './runs.ts';

const visibility = policy.visibility;

/**
 * Persist the run's baselines and refresh the later runs that can reach it.
 * The caller holds the run's finalization transaction, after the run's metric
 * snapshot, completion time and dashboard status are written.
 */
export async function persistComparisonBaselines(
  db: Database,
  input: { workspaceId: string; auditId: string },
): Promise<void> {
  const written = await writeRunBaselines(db, input.workspaceId, input.auditId, async (scope) => {
    // Serializes the project's baseline writers; released at commit.
    await subjectXactLock(db, `comparison-baselines:${scope.projectId}`);
  });
  if (!written) return;
  // A later run that finalized first walked without this one.
  const later = await loadMeasuredRuns(db, written, {
    fromAt: null,
    toAt: null,
    newerThan: input.auditId,
    oldest: visibility.selection_max_runs,
  });
  for (const run of later) await writeRunBaselines(db, input.workspaceId, run.auditId); // NOSONAR -- One transaction connection: runs rewrite in order.
}

/** Compute and upsert one run's baseline rows; the run's scope, or null for a run never compared. */
async function writeRunBaselines(
  db: Database,
  workspaceId: string,
  auditId: string,
  beforeWalk?: (scope: RunScope & { projectId: string }) => Promise<void>,
): Promise<RunScope | null> {
  const run = await db
    .selectFrom('audits as audit')
    .innerJoin('metric_snapshots as snapshot', (join) =>
      join
        .onRef('snapshot.audit_id', '=', 'audit.id')
        .onRef('snapshot.workspace_id', '=', 'audit.workspace_id'),
    )
    .select([
      'audit.project_id',
      'audit.market_id',
      'audit.audit_scope',
      'audit.configuration',
      utcText(sql.ref('audit.completed_at')).as('completed_at'),
      'snapshot.analyzer_version',
      'snapshot.scoring_rule_version',
      'snapshot.metrics',
    ])
    .where('audit.workspace_id', '=', workspaceId)
    .where('audit.id', '=', auditId)
    .executeTakeFirst();
  // Only brand runs are compared; a run without completion has no history before it.
  if (run?.audit_scope !== visibility.brand_audit_scope || run.completed_at === null) return null;
  const completedAt = run.completed_at;
  const scope = { workspaceId, projectId: run.project_id, marketId: run.market_id };
  await beforeWalk?.(scope);
  // Every selector walks the same recent history, read once.
  const candidates = await loadMeasuredRuns(db, scope, {
    fromAt: null,
    toAt: completedAt,
    newest: visibility.selection_max_runs,
  });
  // The engines the run measured: finalization writes each one's slice in every cohort.
  const engines = Object.keys(
    metricObject(cohortMetrics(run.metrics, visibility.core_cohort).per_engine),
  ).sort(compareText);
  const now = new Date();
  const rows = [];
  for (const cohort of visibility.requestable_cohorts) {
    for (const engine of [null, ...engines]) {
      const metrics = cohortMetrics(run.metrics, cohort);
      const current: SelectedRun & { completedAt: string } = {
        auditId,
        workspaceId,
        configuration: run.configuration,
        completedAt,
        analyzerVersion: run.analyzer_version,
        scoringRuleVersion: run.scoring_rule_version,
        metrics: engine === null ? metrics : engineMetrics(metrics, engine),
      };
      const key = frozenComparisonKey(run.configuration, engine);
      const selector = { cohort, engine, baselineId: null };
      const found =
        key === null
          ? emptyComparison({ status: 'identity_unavailable' })
          : await nearestBaseline(db, current, selector, { key, candidates }); // NOSONAR -- One transaction connection: selectors walk in order.
      rows.push({
        id: randomUUID(),
        workspace_id: workspaceId,
        project_id: run.project_id,
        audit_id: auditId,
        cohort,
        logical_engine: engine,
        status: found.status,
        baseline_audit_id: found.baseline_audit_id,
        skipped_runs: found.skipped_runs,
        analyzer_version: run.analyzer_version,
        scoring_rule_version: run.scoring_rule_version,
        created_at: now,
      });
    }
  }
  await db
    .insertInto('audit_comparison_baselines')
    .values(rows)
    .onConflict((conflict) =>
      conflict.constraint('uq_audit_comparison_baseline').doUpdateSet((eb) => ({
        status: eb.ref('excluded.status'),
        baseline_audit_id: eb.ref('excluded.baseline_audit_id'),
        skipped_runs: eb.ref('excluded.skipped_runs'),
        analyzer_version: eb.ref('excluded.analyzer_version'),
        scoring_rule_version: eb.ref('excluded.scoring_rule_version'),
      })),
    )
    .execute();
  return scope;
}
