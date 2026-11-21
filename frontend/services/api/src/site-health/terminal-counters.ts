import { ACTIVE_CRAWL_STATUSES, isActiveCrawl } from '@citeladder/contracts/site-health';

import type { Database } from '../db/database.ts';
import { isTerminal } from './reads/crawl.ts';
import { taskCounters } from './reads/crawl-counters.ts';
import { CRAWL_COLUMNS, type Crawl } from './site-task.ts';

export async function persistTerminalCounters(db: Database, crawl: Crawl): Promise<void> {
  if (!isTerminal(crawl)) throw new TypeError('Only a terminal crawl persists its counters');
  const counters = await taskCounters(db, crawl);
  await db
    .updateTable('site_crawls')
    .set({ terminal_counters: JSON.stringify(counters) })
    .where('workspace_id', '=', crawl.workspace_id)
    .where('id', '=', crawl.id)
    .execute();
}

export async function refreshTerminalCounters(db: Database, crawl: Crawl): Promise<void> {
  if (isTerminal(crawl)) await persistTerminalCounters(db, crawl);
}

/**
 * Recount an active crawl's live counters onto its row, without the crawl
 * lock: a crawl that went terminal meanwhile keeps its row untouched. One
 * connection, so the recount's parallel queries never crowd the runner's slots.
 */
export async function persistLiveCounters(
  db: Database,
  target: { workspace_id: string; crawl_id: string },
): Promise<void> {
  await db.connection().execute(async (conn) => {
    const crawl = await conn
      .selectFrom('site_crawls')
      .select(CRAWL_COLUMNS)
      .where('workspace_id', '=', target.workspace_id)
      .where('id', '=', target.crawl_id)
      .executeTakeFirst();
    if (!crawl || !isActiveCrawl(crawl.status)) return;
    const counters = await taskCounters(conn, crawl);
    await conn
      .updateTable('site_crawls')
      .set({ live_counters: JSON.stringify(counters) })
      .where('workspace_id', '=', crawl.workspace_id)
      .where('id', '=', crawl.id)
      .where('status', 'in', ACTIVE_CRAWL_STATUSES)
      .execute();
  });
}
