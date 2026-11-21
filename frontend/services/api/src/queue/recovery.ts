import { sql, type RawBuilder } from 'kysely';
import { policy } from '../config.ts';
import { queueRecovery } from '../config/queue-recovery.ts';
import type { Database } from '../db/database.ts';
import { getLogger } from '../logging.ts';
import { leasedStatuses } from './next-due.ts';
import { DISCOVERY_LANE, INTEGRATION_LANE, type LaneDescriptor } from './task-queue.ts';

const { statuses } = policy.task_queue;

export type LeaseRecovery = {
  lane: Pick<LaneDescriptor, 'table' | 'recoveryCharge'>;
  batchSize: number;
  scope?: RawBuilder<boolean>;
  at?: Date;
};

export type ReclaimedLease = {
  id: string;
  workspace_id: string;
  status: string;
  attempt_count: number;
};

export function reclaimExpiredLeases(
  db: Database,
  recovery: LeaseRecovery,
): Promise<ReclaimedLease[]> {
  return db.isTransaction
    ? reclaim(db, recovery)
    : db.transaction().execute((trx) => reclaim(trx, recovery));
}

async function reclaim(db: Database, recovery: LeaseRecovery): Promise<ReclaimedLease[]> {
  const { scope } = recovery;
  const { table, recoveryCharge: charge } = recovery.lane;
  const expired = await db
    .selectFrom(table)
    .select(['id', 'workspace_id'])
    .where('status', 'in', leasedStatuses)
    .where('lease_expires_at', '<=', sql<Date>`clock_timestamp()`)
    .$if(scope !== undefined, (q) => q.where(scope!))
    .orderBy('lease_expires_at')
    .orderBy('id')
    .limit(recovery.batchSize)
    .forUpdate()
    .skipLocked()
    .execute();
  if (!expired.length) return [];
  const at = recovery.at ? sql<Date>`${recovery.at}::timestamptz` : sql<Date>`clock_timestamp()`;
  const exhausted = sql<boolean>`attempt_count + ${charge} >= max_attempts`;
  return db
    .updateTable(table)
    .set({
      status: sql<string>`case when ${exhausted} then ${statuses.failed} else ${statuses.retry_wait} end`,
      attempt_count: sql<number>`attempt_count + ${charge}`,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      updated_at: at,
      available_at: sql<Date>`case when ${exhausted} then available_at else ${at} end`,
      completed_at: sql<Date | null>`case when ${exhausted} then ${at} else null end`,
      error_code: sql<string>`case when ${exhausted} and error_code = '' then ${policy.task_queue.max_attempts_error} else error_code end`,
      error_detail: sql<string>`case when ${exhausted} and error_code = '' then 'lease expired after max attempts exhausted' else error_detail end`,
    })
    .where(
      'id',
      'in',
      expired.map((row) => row.id),
    )
    .where(
      'workspace_id',
      'in',
      expired.map((row) => row.workspace_id),
    )
    .returning(['id', 'workspace_id', 'status', 'attempt_count'])
    .execute();
}

function logExhausted(queue: LaneDescriptor['table'], tasks: readonly ReclaimedLease[]) {
  const logger = getLogger('workers.queue-recovery');
  for (const task of tasks) {
    if (task.status === statuses.failed)
      logger.warning('queue_task_attempts_exhausted', {
        queue,
        task_id: task.id,
        workspace_id: task.workspace_id,
        attempt_count: task.attempt_count,
      });
  }
}

export async function recoverDiscoveryLeases(db: Database, batchSize = queueRecovery.batchSize) {
  const tasks = await db.transaction().execute(async (trx) => {
    const tasks = await reclaimExpiredLeases(trx, {
      lane: DISCOVERY_LANE,
      batchSize,
    });
    const cfg = policy.discovery.constants;
    for (const task of tasks.filter((row) => row.status === statuses.failed)) {
      const parent = await trx
        .selectFrom('brand_discoveries as discovery')
        .innerJoin('brand_discovery_tasks as task', (join) =>
          join
            .onRef('task.discovery_id', '=', 'discovery.id')
            .onRef('task.workspace_id', '=', 'discovery.workspace_id'),
        )
        .selectAll('discovery')
        .where('task.id', '=', task.id)
        .where('discovery.workspace_id', '=', task.workspace_id)
        .forUpdate('discovery')
        .executeTakeFirst();
      if (
        !parent ||
        [cfg.discovery_status_ready, cfg.discovery_status_project_created].includes(parent.status)
      )
        continue;
      const warnings = Array.isArray(parent.warnings) ? parent.warnings : [];
      await trx
        .updateTable('brand_discoveries')
        .set({
          status: cfg.discovery_status_failed,
          stage: 'failed',
          error_code: cfg.error_brand_discovery,
          error_detail: policy.task_queue.max_attempts_error,
          warnings: JSON.stringify([...new Set([...warnings, 'research_degraded'])]),
          updated_at: sql<Date>`clock_timestamp()`,
        })
        .where('id', '=', parent.id)
        .where('workspace_id', '=', task.workspace_id)
        .execute();
    }
    return tasks;
  });
  logExhausted('brand_discovery_tasks', tasks);
  return tasks.length;
}

export async function recoverIntegrationLeases(
  db: Database,
  batchSize = queueRecovery.batchSize,
  scope?: { workspaceId: string; runId: string },
) {
  const tasks = await reclaimExpiredLeases(db, {
    lane: INTEGRATION_LANE,
    batchSize,
    scope: scope && sql<boolean>`workspace_id = ${scope.workspaceId} and id = ${scope.runId}`,
  });
  logExhausted('integration_sync_runs', tasks);
  return tasks.length;
}
