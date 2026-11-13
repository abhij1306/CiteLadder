/**
 * The one Server-Sent Events tail over an append-only event table.
 *
 * A tail resumes after a client's `Last-Event-ID`, polls for the next page
 * until its subject has been terminal for the grace polls, is gone, or the
 * stream reaches its maximum duration. The stream is pull-based: the next
 * page is read only when the consumer asks for more, so a slow client never
 * makes the server queue frames. Each page finishes its reads before it is
 * yielded; no transaction stays open while the stream waits.
 */
import { getLogger } from '../logging.ts';
import { waitForPoll } from '../workers/poll.ts';
import { RequestValidationError } from './params.ts';
import { parseUuid } from './uuid.ts';

const logger = getLogger('api.event_stream');

/**
 * The resume cursor of an event read: the `Last-Event-ID` header, else the
 * `last_event_id` query parameter; an empty value is no cursor, as in SSE. A
 * value that is not a UUID is refused with 422 rather than read as "no
 * cursor", which would replay the whole history.
 */
export function resumeCursor(input: {
  header: string | undefined;
  query?: string | null;
}): string | undefined {
  const source: { value: string | null | undefined; loc: string[] } = input.header
    ? { value: input.header, loc: ['header', 'last-event-id'] }
    : { value: input.query, loc: ['query', 'last_event_id'] };
  const { value, loc } = source;
  if (!value) return undefined;
  const parsed = parseUuid(value);
  if (!parsed)
    throw new RequestValidationError([
      { loc, message: 'Input should be a valid UUID', type: 'uuid_parsing' },
    ]);
  return parsed;
}

/** One event as an SSE frame: its id is the client's resume cursor. */
type EventFrame = { id: string; event: string; data: unknown };

/** Where a tail's subject stands after a poll. */
export type SubjectState = 'open' | 'terminal' | 'gone';

export type EventTail = {
  /** Names the stream in logs. */
  stream: string;
  /** The subject's id, for logs. */
  subjectId: string;
  /** Resume after this event; undefined starts from the beginning. */
  after: string | undefined;
  /** The first page, when the route already read it after `after`. */
  first?: readonly EventFrame[];
  /** Up to `settings.pageSize` events after the cursor, oldest first. */
  page: (after: string | undefined) => Promise<readonly EventFrame[]>;
  /** Re-read the subject after a page that was not full. */
  poll: () => Promise<SubjectState>;
  settings: {
    pageSize: number;
    pollSeconds: number;
    maxSeconds: number;
    terminalGracePolls: number;
  };
};

const encodeFrame = ({ id, event, data }: EventFrame) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** The tail's frames until it ends or `signal` aborts. */
export async function* eventFrames(tail: EventTail, signal: AbortSignal): AsyncGenerator<string> {
  const { settings } = tail;
  const deadline = Date.now() + settings.maxSeconds * 1000;
  let cursor = tail.after,
    prepared = tail.first,
    terminalPolls = 0;
  while (!signal.aborted && Date.now() < deadline) {
    const events = prepared ?? (await tail.page(cursor));
    prepared = undefined;
    for (const event of events) {
      // A slow reader still ends at the deadline; it resumes after the last frame it got.
      if (signal.aborted || Date.now() >= deadline) return;
      cursor = event.id;
      yield encodeFrame(event);
    }
    // A full page means a backlog: drain it before any grace counting.
    if (events.length >= settings.pageSize) continue;
    const state = await tail.poll();
    if (state === 'gone') return;
    if (state === 'terminal' && ++terminalPolls >= settings.terminalGracePolls) return;
    // Never wait past the stream's deadline, whatever the poll interval.
    const delay = Math.min(settings.pollSeconds * 1000, Math.max(0, deadline - Date.now()));
    await waitForPoll(delay, signal); // NOSONAR -- Poll interval between event pages.
  }
}

/** The tail as a pull-based byte stream; cancelling it stops the polling. */
export function eventTailStream(tail: EventTail, held: AbortSignal): ReadableStream<Uint8Array> {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([cancellation.signal, held]);
  const frames = eventFrames(tail, signal);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await frames.next();
        if (next.done || signal.aborted) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        // A client that already went away has nothing left to receive.
        if (signal.aborted) {
          controller.close();
          return;
        }
        logger.exception('event_stream_failed', error, {
          stream: tail.stream,
          subject_id: tail.subjectId,
        });
        controller.error(error);
      }
    },
    async cancel() {
      cancellation.abort();
      await frames.return(undefined);
    },
  });
}

/**
 * The response that carries every event stream, a tail or the Agent's live
 * turn; proxies must not buffer it.
 */
export function eventStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}
