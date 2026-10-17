/** Site Health's sole expired-lease writer; the worker reconciles crawls whose tasks it fails. */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { reclaimExpiredLeases } from '../queue/recovery.ts';

const logger = getLogger('app.workers.site_health_worker');

export async function recoverExpiredLeases(
  db: Database,
  batchSize: number,
  now = new Date(),
  scope?: { workspaceId: string; crawlId: string },
) {
  const rows = await reclaimExpiredLeases(db, {
    table: 'site_crawl_tasks',
    charge: 1,
    batchSize,
    at: now,
    scope:
      scope && sql<boolean>`workspace_id = ${scope.workspaceId} and crawl_id = ${scope.crawlId}`,
  });
  const failed = rows.filter((task) => task.status === 'failed');
  // A failed task is terminal and its crawl never changes, so reading it after the commit is exact.
  const failedTasks = failed.length
    ? await db
        .selectFrom('site_crawl_tasks')
        .select(['id', 'workspace_id', 'crawl_id', 'attempt_count'])
        .where(
          'workspace_id',
          'in',
          failed.map((task) => task.workspace_id),
        )
        .where(
          'id',
          'in',
          failed.map((task) => task.id),
        )
        .execute()
    : [];
  for (const task of failedTasks)
    logger.warning('sweeper failed task at max attempts', {
      task_id: task.id,
      parent_id: task.crawl_id,
      attempt_count: task.attempt_count,
      queue: 'site_crawl_tasks',
    });
  if (rows.length)
    logger.info('sweeper reclaimed expired leases', {
      reclaimed: rows.length,
      failed: failed.length,
    });
  const crawls = new Map(
    failedTasks.map((task) => [
      task.crawl_id,
      { crawlId: task.crawl_id, workspaceId: task.workspace_id },
    ]),
  );
  return {
    reclaimed: rows.length,
    failedTaskIds: failed.map((task) => task.id),
    failedCrawls: [...crawls.values()],
  };
}
