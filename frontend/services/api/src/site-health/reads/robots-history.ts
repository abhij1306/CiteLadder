import { robotsFactsSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { wireUtc, utcTextOf } from '../../db/timestamps.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { parseUuid } from '../../http/uuid.ts';
import { loadProject } from './crawl.ts';

/** Observation order belongs to crawls; content-addressed bodies may recur. */
export async function robotsHistory(
  db: Database,
  workspaceId: string,
  projectId: string,
  input: { limit: number; cursor: string | null },
) {
  await loadProject(db, workspaceId, projectId);
  const workspace = new WorkspaceScope(workspaceId);
  const filters = { workspace_id: workspaceId, project_id: projectId };
  let query = workspace
    .selectFrom(db, 'site_crawls')
    .select(['id', 'robots_snapshot_id'])
    .select(sql<unknown>`site_facts -> 'robots'`.as('robots'))
    .select(utcTextOf(sql.ref('robots_observed_at')).as('observed_at'))
    .where('project_id', '=', projectId)
    .where('robots_observed_at', 'is not', null);
  if (input.cursor) {
    const keys = decodeKeysetCursor(input.cursor, 'robots-history', filters);
    const id = parseUuid(keys[1]);
    if (keys.length !== 2 || !keys[0] || !Number.isFinite(Date.parse(keys[0])) || !id)
      throw new InvalidCursorError('invalid cursor');
    query = query.where(
      sql<boolean>`(robots_observed_at, id) < (${keys[0]}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await query
    .orderBy('robots_observed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(input.limit + 1)
    .execute();
  const page = rows.slice(0, input.limit);
  const ids = [
    ...new Set(page.flatMap((row) => (row.robots_snapshot_id ? [row.robots_snapshot_id] : []))),
  ];
  const snapshots = ids.length
    ? await workspace
        .selectFrom(db, 'robots_snapshots')
        .select(['id', 'origin', 'content_hash', 'body', 'truncated', 'status_code'])
        .where('project_id', '=', projectId)
        .where('id', 'in', ids)
        .execute()
    : [];
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      crawl_id: row.id,
      robots: robotsFactsSchema.parse(row.robots),
    })),
    snapshots,
    next_cursor:
      rows.length > input.limit && last
        ? encodeKeysetCursor('robots-history', filters, [wireUtc(last.observed_at), last.id])
        : null,
  };
}
