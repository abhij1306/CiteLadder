import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';

export type TrafficScope = 'page' | 'query';

export const windowDays = sql<number>`(window_end::date - window_start::date + 1)`;

export async function scopedDailyRate(
  db: Database,
  owner: { workspaceId: string; projectId: string },
  snapshot: { id: string; days: number },
  target: { scope: TrafficScope; key: string; metric: string },
) {
  const workspace = new WorkspaceScope(owner.workspaceId);
  const row =
    target.scope === 'page'
      ? await workspace
          .selectFrom(db, 'traffic_page_stats')
          .select(['id', 'metrics'])
          .where('project_id', '=', owner.projectId)
          .where('snapshot_id', '=', snapshot.id)
          .where('canonical_url', '=', target.key)
          .executeTakeFirst()
      : await workspace
          .selectFrom(db, 'traffic_query_stats')
          .select(['id', 'metrics'])
          .where('project_id', '=', owner.projectId)
          .where('snapshot_id', '=', snapshot.id)
          .where('normalized_query', '=', target.key)
          .executeTakeFirst();
  const value = record(row?.metrics)[target.metric];
  return {
    rowId: row?.id ?? null,
    rate:
      typeof value === 'number' && Number.isFinite(value) ? value / Number(snapshot.days) : null,
  };
}
