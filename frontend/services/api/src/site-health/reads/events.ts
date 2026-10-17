/**
 * Crawl events as a JSON replay or a Server-Sent Events tail.
 *
 * Both resume after a client's last event id; an id that is not an event of
 * this crawl yields nothing rather than replaying the whole history. Without
 * count disclosure every payload drops its total-bearing keys.
 */
import { siteCrawlEventSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { setTimeout as sleep } from 'node:timers/promises';
import type { z } from 'zod';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record } from '../../db/json.ts';
import { ApiError } from '../../errors.ts';
import { getLogger } from '../../logging.ts';
import { siteReadSettings } from '../runtime.ts';
import { countDisclosure, isTerminal, loadCrawl, type Crawl } from './crawl.ts';

const logger = getLogger('app.site_health.events');
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

async function loadEvents(db: Database, crawl: Crawl, after: string | null, limit: number) {
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
  after: string | null,
): Promise<z.infer<typeof siteCrawlEventSchema>[]> {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const events = await loadEvents(db, crawl, after, siteReadSettings().maxEventPage);
  return events.map((event) => eventView(event, countDisclosure(crawl)));
}

/**
 * Tail a crawl's events until it has been terminal for the grace polls or the
 * stream reaches its maximum duration. Each poll reloads the crawl in the
 * workspace, so a crawl that disappears ends the stream.
 */
export function eventStream(
  db: Database,
  workspaceId: string,
  crawl: Crawl,
  after: string | null,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const settings = siteReadSettings();
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let last = after;
      let terminalPolls = 0;
      const deadline = Date.now() + settings.sseMaxSeconds * 1000;
      // A crawl deleted mid-stream ends the stream.
      const reload = (id: string) =>
        loadCrawl(db, workspaceId, id).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        });
      try {
        let current: Crawl | null = crawl;
        while (current && !signal.aborted) {
          const events = await loadEvents(db, current, last, settings.maxEventPage);
          for (const event of events) {
            last = event.id;
            const body = JSON.stringify(eventView(event, countDisclosure(current)));
            controller.enqueue(
              encoder.encode(`event: ${event.event_type}\nid: ${event.id}\ndata: ${body}\n\n`),
            );
          }
          // A full page means a backlog: drain it before any grace counting.
          if (events.length === settings.maxEventPage) continue;
          if (isTerminal(current) && ++terminalPolls >= TERMINAL_GRACE_POLLS) break;
          if (Date.now() >= deadline) break;
          await sleep(settings.ssePollSeconds * 1000, undefined, { signal }).catch(() => {}); // NOSONAR: polls are sequential.
          current = await reload(current.id); // NOSONAR: polls are sequential.
        }
        controller.close();
      } catch (error) {
        // A client that already went away has nothing left to receive.
        if (signal.aborted) return;
        logger.exception('site_health_event_stream_failed', error, { crawl_id: crawl.id });
        controller.error(error);
      }
    },
  });
}
