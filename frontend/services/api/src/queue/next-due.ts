import { sql, type RawBuilder } from 'kysely';
import type { Database } from '../db/database.ts';
import type { LaneDescriptor } from './task-queue.ts';

/** Statuses whose lease each lane's recovery reclaims once `lease_expires_at` passes. */
export const leasedStatuses = ['leased', 'running'] as const;

/**
 * When a lane's next task is due: the earlier of its next claimable row and its
 * next lease expiry. An expired lease is pending work: a killed request or
 * execution leaves it for recovery, so an idle runner must stay (or start a
 * successor) for it too. Each side is its own `min()` so it can read its own
 * index: the lane's claim index (claimable rows in `available_at` order) and
 * its (status, lease_expires_at) index where it has one (`agent_runs` has none).
 * `least` ignores the side with no rows.
 */
export async function nextDueAt(
  db: Database,
  options: {
    table: LaneDescriptor['table'];
    claimable: readonly string[];
    /** Extra claimability, such as remaining attempts. */
    ready?: RawBuilder<boolean>;
    /** Narrows both sides, such as task kinds or one workspace's crawl. */
    scope?: RawBuilder<boolean>;
  },
): Promise<Date | null> {
  const table = sql.table(options.table);
  const scope = options.scope ?? sql<boolean>`true`;
  const ready = options.ready ?? sql<boolean>`true`;
  const { rows } = await sql<{ due: Date | string | null }>`select least(
      (select min(available_at) from ${table}
        where status in (${sql.join(options.claimable)}) and ${ready} and ${scope}),
      (select min(lease_expires_at) from ${table}
        where status in (${sql.join(leasedStatuses)}) and ${scope})
    ) as due`.execute(db);
  const due = rows[0]?.due;
  return due ? new Date(due) : null;
}
