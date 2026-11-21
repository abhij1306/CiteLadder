import { sql, type RawBuilder } from 'kysely';
import type { Database } from '../db/database.ts';
import type { LaneDescriptor } from './task-queue.ts';

export const leasedStatuses = ['leased', 'running'] as const;

export async function nextDueAt(
  db: Database,
  options: {
    table: LaneDescriptor['table'];
    claimable: readonly string[];
    ready?: RawBuilder<boolean>;
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
