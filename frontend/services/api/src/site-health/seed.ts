/** Local seed controls compose existing admission and selection owners. */
import type { Database } from '../db/database.ts';
import { createCrawl } from './planner.ts';
import { bulkMonitoredSet } from './selection.ts';

export function seedCrawl(db: Database, workspaceId: string, projectId: string, seed: string) {
  return db
    .transaction()
    .execute(
      async (trx) => (await createCrawl(trx, workspaceId, { project_id: projectId, seed })).id,
    );
}
export function seedSelection(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string,
) {
  return db.transaction().execute(async (trx) => {
    const profile = await trx
      .selectFrom('site_health_profiles')
      .select('selection_version')
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    await bulkMonitoredSet(trx, workspaceId, projectId, {
      crawl_id: crawlId,
      mode: 'all',
      expected_selection_version: profile.selection_version,
    });
    return crawlId;
  });
}
