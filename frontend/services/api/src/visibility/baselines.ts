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

export async function persistComparisonBaselines(
  db: Database,
  input: { workspaceId: string; auditId: string },
): Promise<void> {
  const written = await writeRunBaselines(db, input.workspaceId, input.auditId, async (scope) => {
    await subjectXactLock(db, `comparison-baselines:${scope.projectId}`);
  });
  if (!written) return;
  const later = await loadMeasuredRuns(db, written, {
    fromAt: null,
    toAt: null,
    newerThan: input.auditId,
    oldest: visibility.selection_max_runs,
  });
  for (const run of later) await writeRunBaselines(db, input.workspaceId, run.auditId); // NOSONAR
}

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
  if (run?.audit_scope !== visibility.brand_audit_scope || run.completed_at === null) return null;
  const completedAt = run.completed_at;
  const scope = { workspaceId, projectId: run.project_id, marketId: run.market_id };
  await beforeWalk?.(scope);
  const candidates = await loadMeasuredRuns(db, scope, {
    fromAt: null,
    toAt: completedAt,
    newest: visibility.selection_max_runs,
  });
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
          : await nearestBaseline(db, current, selector, { key, candidates }); // NOSONAR
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
