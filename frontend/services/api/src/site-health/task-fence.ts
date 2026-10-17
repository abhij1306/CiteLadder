/** Site Health's canonical write lock order is crawl, then task. */
import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { SiteCrawls } from '../generated/db-schema.ts';
import type { SiteTask } from '../queue/task-queue.ts';
import { TaskCancelledError } from '../workers/executor.ts';

export type Crawl = Selectable<SiteCrawls>;
/**
 * `fence` takes FOR KEY SHARE on the task so the heartbeat's non-key UPDATE can
 * extend the lease while an executor runs; `acknowledge` takes FOR UPDATE.
 */
export async function lockSiteTask(
  db: Database,
  claimed: SiteTask,
  owner: string,
  mode: 'fence' | 'acknowledge' = 'acknowledge',
) {
  const crawl = await db
    .selectFrom('site_crawls as crawl')
    .innerJoin('projects as project', (join) =>
      join
        .onRef('project.id', '=', 'crawl.project_id')
        .onRef('project.workspace_id', '=', 'crawl.workspace_id'),
    )
    .selectAll('crawl')
    .where('crawl.id', '=', claimed.crawl_id)
    .where('crawl.workspace_id', '=', claimed.workspace_id)
    .forUpdate('crawl')
    .executeTakeFirst();
  const query = db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('id', '=', claimed.id)
    .where('crawl_id', '=', claimed.crawl_id)
    .where('workspace_id', '=', claimed.workspace_id)
    .where('status', '=', 'running')
    .where('lease_owner', '=', owner)
    .where('lease_expires_at', '>', sql<Date>`clock_timestamp()`);
  const task = await (
    mode === 'fence' ? query.forKeyShare() : query.forUpdate()
  ).executeTakeFirst();
  if (!crawl || !task) throw new TaskCancelledError('Site Health task lost its lease or scope');
  return { crawl, task };
}
