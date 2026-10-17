/**
 * Whether a selected run set may be compared with a baseline run set.
 *
 * The prompt and source tables ask the same question. Two sets compare only when every run is known, the
 * baseline finished entirely before the selection, every run is fully
 * covered and all share one frozen identity and versions.
 */
import { frozenComparisonKey } from '../analysis/comparison.ts';
import type { Database } from '../db/database.ts';
import { utcText } from '../db/timestamps.ts';
import { sql } from 'kysely';
import { cohortMetrics, engineMetrics, isComplete, measurementCounts } from './metrics.ts';
import type { RunScope } from './runs.ts';

export async function runSetComparisonStatus(
  db: Database,
  scope: RunScope,
  input: {
    currentIds: readonly string[];
    baselineIds: readonly string[];
    responses: number;
    engine: string | null;
    cohort: string;
  },
): Promise<string> {
  const ids = new Set([...input.currentIds, ...input.baselineIds]);
  const rows = await db
    .selectFrom('audits as audit')
    .innerJoin('metric_snapshots as snapshot', 'snapshot.audit_id', 'audit.id')
    .select([
      'audit.id',
      'audit.configuration',
      utcText(sql.ref('audit.completed_at')).as('completed_at'),
      'snapshot.analyzer_version',
      'snapshot.scoring_rule_version',
      'snapshot.metrics',
    ])
    .where('audit.workspace_id', '=', scope.workspaceId)
    .where('audit.project_id', '=', scope.projectId)
    .where('audit.id', 'in', [...ids])
    .execute();
  if (rows.length !== ids.size || !rows.every((row) => ids.has(row.id))) {
    return 'identity_unavailable';
  }
  // An unfinished run cannot be shown to precede another.
  const dates = (wanted: readonly string[]) =>
    rows.filter((row) => wanted.includes(row.id)).map((row) => row.completed_at);
  const current = dates(input.currentIds);
  const baseline = dates(input.baselineIds);
  const latestBaseline = baseline.toSorted().at(-1);
  const earliestCurrent = current.toSorted()[0];
  if (
    latestBaseline == null ||
    earliestCurrent == null ||
    [...current, ...baseline].includes(null) ||
    latestBaseline >= earliestCurrent
  ) {
    return 'invalid_baseline';
  }
  if (!input.responses) return 'no_observations';
  const identities = new Set<string>();
  for (const row of rows) {
    const key = frozenComparisonKey(row.configuration, input.engine);
    if (key === null) return 'identity_unavailable';
    identities.add(JSON.stringify([key, row.analyzer_version, row.scoring_rule_version]));
    const cohort = cohortMetrics(row.metrics, input.cohort);
    const metrics = input.engine === null ? cohort : engineMetrics(cohort, input.engine);
    if (!isComplete(measurementCounts(metrics))) return 'partial_coverage';
  }
  return identities.size !== 1 || input.currentIds.length === 0 ? 'changed_context' : 'comparable';
}
