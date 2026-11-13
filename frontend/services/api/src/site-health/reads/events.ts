/**
 * Crawl events as a JSON replay or a Server-Sent Events tail.
 *
 * Both resume after a client's last event id; an id that is not an event of
 * this crawl yields nothing rather than replaying the whole history, and one
 * that is not a UUID is refused before either is read. Without
 * count disclosure every payload drops its total-bearing keys.
 */
import { siteCrawlEventSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import type { z } from 'zod';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record } from '../../db/json.ts';
import { ApiError } from '../../errors.ts';
import type { EventTail } from '../../http/event-stream.ts';
import { siteReadSettings } from '../runtime.ts';
import { countDisclosure, isTerminal, loadCrawl, type Crawl } from './crawl.ts';

const COUNT_BEARING = new Set<string>(policy.site_health.reads.event_count_bearing_keys);
// Polls after the crawl turns terminal, so its final events still arrive.
const TERMINAL_GRACE_POLLS = policy.site_health.reads.terminal_grace_polls;

type EventRow = {
  id: string;
  crawl_id: string;
  event_type: string;
  message: string;
  payload: unknown;
  created_at: Date;
};

async function loadEvents(db: Database, crawl: Crawl, after: string | undefined, limit: number) {
  const anchor = after
    ? sql`and (e.created_at, e.id) > ((
        select created_at from site_crawl_events where id = ${after} and crawl_id = ${crawl.id}
      ), ${after}::uuid)`
    : sql``;
  const { rows } = await sql<EventRow>`
    select e.* from site_crawl_events e where e.crawl_id = ${crawl.id} ${anchor}
    order by e.created_at, e.id limit ${limit}`.execute(db);
  return rows;
}

function eventView(event: EventRow, disclose: boolean) {
  const payload = record(event.payload);
  return siteCrawlEventSchema.parse({
    id: event.id,
    crawl_id: event.crawl_id,
    event_type: event.event_type,
    message: event.message,
    payload: disclose
      ? payload
      : Object.fromEntries(Object.entries(payload).filter(([key]) => !COUNT_BEARING.has(key))),
    created_at: event.created_at.toISOString(),
  });
}

export async function eventReplay(
  db: Database,
  workspaceId: string,
  crawlId: string,
  after: string | undefined,
): Promise<z.infer<typeof siteCrawlEventSchema>[]> {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const events = await loadEvents(db, crawl, after, siteReadSettings().maxEventPage);
  return events.map((event) => eventView(event, countDisclosure(crawl)));
}

/**
 * A crawl's events as a tail. Each poll reloads the crawl in the workspace,
 * so a crawl that disappears ends the stream, and the next page is disclosed
 * as the crawl now allows.
 */
export function crawlEventTail(
  db: Database,
  workspaceId: string,
  crawl: Crawl,
  after: string | undefined,
): EventTail {
  const settings = siteReadSettings();
  let current = crawl;
  return {
    stream: 'site_health',
    subjectId: crawl.id,
    after,
    page: async (cursor) =>
      (await loadEvents(db, current, cursor, settings.maxEventPage)).map((event) => ({
        id: event.id,
        event: event.event_type,
        data: eventView(event, countDisclosure(current)),
      })),
    poll: async () => {
      try {
        current = await loadCrawl(db, workspaceId, current.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return 'gone';
        throw error;
      }
      return isTerminal(current) ? 'terminal' : 'open';
    },
    settings: {
      pageSize: settings.maxEventPage,
      pollSeconds: settings.ssePollSeconds,
      maxSeconds: settings.sseMaxSeconds,
      terminalGracePolls: TERMINAL_GRACE_POLLS,
    },
  };
}
