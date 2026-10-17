/** Discovery queue leases; recovery serializes against heartbeat and publication. */
import { randomUUID } from 'node:crypto';

import { sql, type Selectable } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { BrandDiscoveryTasks } from '../generated/db-schema.ts';
import { nextDueAt } from './next-due.ts';

export type DiscoveryTask = Selectable<BrandDiscoveryTasks>;
export type DiscoveryTarget = { workspaceId: string; discoveryId: string };
const table = 'brand_discovery_tasks';
const { statuses, claimable } = policy.task_queue;
export class DiscoveryQueue {
  readonly db: Database;
  readonly leaseSeconds: number;
  readonly now: () => Date;
  constructor(db: Database, leaseSeconds: number, now = () => new Date()) {
    this.db = db;
    this.leaseSeconds = leaseSeconds;
    this.now = now;
  }
  claim(owner: string, target?: DiscoveryTarget): Promise<DiscoveryTask | null> {
    const now = this.now();
    return this.db.transaction().execute(async (trx) => {
      const selected = await trx
        .selectFrom(table)
        .leftJoin('queue_workspace_turns as turns', (join) =>
          join
            .onRef('turns.workspace_id', '=', 'brand_discovery_tasks.workspace_id')
            .on('turns.queue_name', '=', table),
        )
        .selectAll(table)
        .where('brand_discovery_tasks.status', 'in', claimable)
        .where('brand_discovery_tasks.available_at', '<=', sql<Date>`clock_timestamp()`)
        .whereRef('brand_discovery_tasks.attempt_count', '<', 'brand_discovery_tasks.max_attempts')
        .$if(Boolean(target), (query) =>
          query
            .where('brand_discovery_tasks.workspace_id', '=', target!.workspaceId)
            .where('brand_discovery_tasks.discovery_id', '=', target!.discoveryId),
        )
        .where('task_kind', '=', policy.discovery.constants.task_kind_brand_discovery)
        .orderBy(sql`turns.last_claimed_at asc nulls first`)
        .orderBy('priority', 'desc')
        .orderBy('available_at')
        .orderBy('brand_discovery_tasks.created_at')
        .limit(1)
        .forUpdate(table)
        .skipLocked()
        .executeTakeFirst();
      if (!selected) return null;
      const task = await trx
        .updateTable(table)
        .set({
          status: statuses.running,
          lease_owner: owner,
          lease_expires_at: sql<Date>`clock_timestamp() + ${this.leaseSeconds} * interval '1 second'`,
          heartbeat_at: now,
          updated_at: now,
        })
        .where('id', '=', selected.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('queue_workspace_turns')
        .values({
          id: randomUUID(),
          queue_name: table,
          workspace_id: task.workspace_id,
          last_claimed_at: now,
          created_at: now,
        })
        .onConflict((conflict) =>
          conflict.constraint('uq_queue_workspace_turn').doUpdateSet({
            last_claimed_at: sql`greatest(queue_workspace_turns.last_claimed_at, ${now})`,
          }),
        )
        .execute();
      return task;
    });
  }
  /** Earliest claimable time or lease expiry, so an idle runner stays for a retry or recovery due soon. */
  nextDue(): Promise<Date | null> {
    return nextDueAt(this.db, {
      table,
      claimable,
      ready: sql`attempt_count < max_attempts`,
      scope: sql`task_kind = ${policy.discovery.constants.task_kind_brand_discovery}`,
    });
  }
  async heartbeat(task: DiscoveryTask, owner: string) {
    const now = this.now();
    const result = await this.db
      .updateTable(table)
      .set({
        heartbeat_at: now,
        updated_at: now,
        lease_expires_at: sql<Date>`clock_timestamp() + ${this.leaseSeconds} * interval '1 second'`,
      })
      .where('id', '=', task.id)
      .where('workspace_id', '=', task.workspace_id)
      .where('lease_owner', '=', owner)
      .where('status', '=', statuses.running)
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
  lockedTask(db: Database, task: DiscoveryTask, owner: string) {
    return db
      .selectFrom(table)
      .selectAll()
      .where('id', '=', task.id)
      .where('workspace_id', '=', task.workspace_id)
      .where('lease_owner', '=', owner)
      .where('status', '=', statuses.running)
      .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`)
      .forUpdate()
      .executeTakeFirst();
  }
}
