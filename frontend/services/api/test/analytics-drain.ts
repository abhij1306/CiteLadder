import { loadWorkerSettings } from '../src/config.ts';
import type { Database } from '../src/db/database.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';

type DrainOptions = Omit<
  NonNullable<ConstructorParameters<typeof AnalyticsWorker>[2]>,
  'taskScope'
>;

/**
 * Ids of the workspace's analytics tasks, optionally of one kind. The local
 * database is shared with other test runs, so analytics workers in tests are
 * scoped to these ids rather than claiming whatever the queue holds.
 */
export async function workspaceTaskIds(db: Database, workspaceId: string, kind?: string) {
  const rows = await db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .$if(kind !== undefined, (query) => query.where('task_kind', '=', kind!))
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Drains one workspace's analytics tasks, successors included, as
 * `runUntilIdle` drains the queue: each pass is scoped to the tasks the
 * workspace holds then. Returns how many tasks ran.
 */
export async function drainWorkspace(
  db: Database,
  workspaceId: string,
  options: DrainOptions = {},
  settings = loadWorkerSettings({}),
) {
  let total = 0;
  for (let batch = 0; batch < 1000; batch += 1) {
    const taskIds = await workspaceTaskIds(db, workspaceId);
    if (taskIds.length === 0) break;
    const taskScope = { workspaceId, taskIds };
    const ran = await new AnalyticsWorker(db, settings, { ...options, taskScope }).runOnce();
    if (ran === 0) break;
    total += ran;
  }
  return total;
}
