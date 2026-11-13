/**
 * The reads one Search Intelligence acquisition locks and checks, scoped to
 * its task's workspace and project. AcquisitionState owns the transactions
 * and the lock order; nothing here writes.
 */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { AcquisitionState } from './acquisition-state.ts';

type Scope = Pick<AcquisitionState, 'task' | 'projectId' | 'runId'>;

export function runQuery(db: Database, scope: Scope) {
  return db
    .selectFrom('search_intelligence_runs')
    .selectAll()
    .where('workspace_id', '=', scope.task.workspace_id)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', scope.runId);
}
export function callsQuery(db: Database, scope: Scope) {
  return db
    .selectFrom('search_intelligence_calls')
    .selectAll()
    .where('workspace_id', '=', scope.task.workspace_id)
    .where('project_id', '=', scope.projectId)
    .where('run_id', '=', scope.runId);
}
/** The task, locked, while this execution still holds its live lease. */
export function ownedTask(db: Database, { task }: Scope) {
  return db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', task.project_id)
    .where('id', '=', task.id)
    .where('lease_owner', '=', task.lease_owner)
    .where('status', '=', 'running')
    .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
    .forUpdate()
    .executeTakeFirst();
}
/** The task, locked, once it has failed or been cancelled. */
export function endedTask(db: Database, { task }: Scope) {
  return db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', task.project_id)
    .where('id', '=', task.id)
    .where('status', 'in', ['failed', 'cancelled'])
    .forUpdate()
    .executeTakeFirst();
}
/** The call's latest dispatch attempt, or undefined before its first. */
export function latestDispatch(
  db: Database,
  run: { workspace_id: string; project_id: string },
  callId: string,
) {
  return db
    .selectFrom('search_intelligence_dispatch_attempts')
    .selectAll()
    .where('workspace_id', '=', run.workspace_id)
    .where('project_id', '=', run.project_id)
    .where('call_id', '=', callId)
    .where('phase', '=', 'dispatch')
    .orderBy('ordinal', 'desc')
    .executeTakeFirst();
}
type RunRef = { id: string; workspace_id: string; project_id: string };

/** The run's dataset for one plan scope, locked, if it was already opened. */
export function scopedDataset(db: Database, run: RunRef, scopeHash: string) {
  return db
    .selectFrom('search_intelligence_datasets')
    .selectAll()
    .where('workspace_id', '=', run.workspace_id)
    .where('project_id', '=', run.project_id)
    .where('run_id', '=', run.id)
    .where('scope_hash', '=', scopeHash)
    .forUpdate()
    .executeTakeFirst();
}
/** The call's dataset, locked. */
export function callDataset(db: Database, run: RunRef, datasetId: string) {
  return db
    .selectFrom('search_intelligence_datasets')
    .selectAll()
    .where('workspace_id', '=', run.workspace_id)
    .where('project_id', '=', run.project_id)
    .where('id', '=', datasetId)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
/** Every dataset of the run, with its status and coverage. */
export function runDatasets(db: Database, run: RunRef) {
  return db
    .selectFrom('search_intelligence_datasets')
    .select(['status', 'coverage'])
    .where('workspace_id', '=', run.workspace_id)
    .where('project_id', '=', run.project_id)
    .where('run_id', '=', run.id)
    .execute();
}
/** The attempt's recorded outcome, if one was already written. */
export function priorOutcome(
  db: Database,
  call: { workspace_id: string; project_id: string; id: string },
  ordinal: number,
) {
  return db
    .selectFrom('search_intelligence_dispatch_attempts')
    .select('id')
    .where('workspace_id', '=', call.workspace_id)
    .where('project_id', '=', call.project_id)
    .where('call_id', '=', call.id)
    .where('ordinal', '=', ordinal)
    .where('phase', '=', 'outcome')
    .executeTakeFirst();
}
