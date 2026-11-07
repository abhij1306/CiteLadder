/** Analytics recovery is bounded and serializes against heartbeats and publication. */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { ANALYTICS_KIND_NAMES } from '../workers/analytics-kinds.ts';
import { reclaimExpiredLeases } from './recovery.ts';
import { ANALYTICS_LANE, type ClaimScope } from './task-queue.ts';
const { statuses } = policy.task_queue;

export async function recoverAnalyticsLeases(db: Database, batchSize: number, scope?: ClaimScope) {
  if (scope && !scope.taskIds.length) return 0;
  const kinds = sql<boolean>`task_kind in (${sql.join(ANALYTICS_KIND_NAMES)})`;
  const rows = await reclaimExpiredLeases(db, {
    lane: ANALYTICS_LANE,
    batchSize,
    scope: scope
      ? sql<boolean>`${kinds} and workspace_id = ${scope.workspaceId} and id in (${sql.join(scope.taskIds)})`
      : kinds,
  });
  const logger = getLogger('workers.analytics-recovery');
  for (const task of rows.filter((row) => row.status === statuses.failed))
    logger.warning('analytics lease recovery exhausted attempts', {
      task_id: task.id,
      attempt_count: task.attempt_count,
      queue: 'analytics_tasks',
    });
  if (rows.length)
    logger.info('analytics recovered expired leases', {
      reclaimed: rows.length,
      failed: rows.filter((row) => row.status === statuses.failed).length,
    });
  return rows.length;
}
