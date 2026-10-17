import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { TaskCancelledError } from '../workers/executor.ts';

/** Lock the task row while this worker still holds its live lease. */
export function lockOwnedTask(db: Database, task: QueueTask) {
  return db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', task.project_id)
    .where('status', '=', 'running')
    .where('lease_owner', '=', task.lease_owner)
    .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
    .forUpdate()
    .executeTakeFirst();
}

/** Called inside the mutation transaction, before project/page locks. */
export async function fenceInspectionTask(db: Database, task?: QueueTask) {
  if (task && !(await lockOwnedTask(db, task))) {
    throw new TaskCancelledError('Source-page inspection no longer owns its lease');
  }
}
