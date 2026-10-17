import { sql } from 'kysely';
import { activeJobRetrySeconds, loadWorkerSettings, policy } from '../config.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { demandSourceRevision } from './source.ts';
import type { DemandScope } from './query-evidence.ts';

export async function enqueueManualDemand(
  db: Database,
  scope: DemandScope,
): Promise<string | null> {
  await subjectXactLock(db, `demand_manual:${scope.workspaceId}`);
  const workspace = new WorkspaceScope(scope.workspaceId);
  const saved = await workspace
    .selectFrom(db, 'demand_snapshots')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .where('window_start', '=', sql<Date>`${scope.windowStart}::date`)
    .where('window_end', '=', sql<Date>`${scope.windowEnd}::date`)
    .limit(1)
    .executeTakeFirst();
  if (!saved)
    throw new ApiError(422, 'Refresh a saved Search Demand window', {
      code: 'demand_window_not_saved',
    });
  const revision = await demandSourceRevision(db, scope);
  const id = await enqueueTask(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: 'demand_snapshot_refresh',
    payload: {
      window_start: scope.windowStart,
      window_end: scope.windowEnd,
      source_revision: revision,
      manual: true,
    },
    keyParts: [scope.projectId, scope.windowStart, scope.windowEnd, 0, revision],
    maxAttempts: loadWorkerSettings().taskMaxAttempts,
  });
  if (!id) return null;
  const active = await workspace
    .selectFrom(db, 'analytics_tasks')
    .select(sql<string>`count(*)`.as('count'))
    .where('project_id', '=', scope.projectId)
    .where('task_kind', '=', 'demand_snapshot_refresh')
    .where('status', 'in', policy.demand.active_task_statuses)
    .where(sql<boolean>`(payload ->> 'manual')::boolean is distinct from false`)
    .executeTakeFirstOrThrow();
  if (Number(active.count) > policy.demand.DEMAND_MANUAL_ACTIVE_PER_PROJECT)
    throw new ApiError(
      429,
      'A Search Demand refresh is already pending for this project. Retry after it finishes.',
      { headers: { 'Retry-After': String(activeJobRetrySeconds()) } },
    );
  return id;
}
