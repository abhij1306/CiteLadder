/**
 * A terminal crawl's dashboard counters, persisted on
 * `site_crawls.terminal_counters` so reading a finished crawl never rescans
 * its tasks and analyses.
 *
 * The owner that makes a crawl terminal (terminalization, cancellation) writes
 * them in that transaction, after its last task changed; a rewrite of a
 * terminal crawl's analyses (a late analysis over a finalized one, a duplicate
 * alias retiring analyses, the cancelled crawl's publication) writes them
 * again. The live monitored selection is configuration, not crawl evidence,
 * and stays out of them.
 */
import type { Database } from '../db/database.ts';
import { isTerminal, taskCounters } from './reads/crawl.ts';
import type { Crawl } from './site-task.ts';

/** Persist the counters of a crawl whose in-memory status is already terminal. */
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

/** Rewrite the counters after a terminal crawl's analyses changed; an active crawl counts live. */
export async function refreshTerminalCounters(db: Database, crawl: Crawl): Promise<void> {
  if (isTerminal(crawl)) await persistTerminalCounters(db, crawl);
}
