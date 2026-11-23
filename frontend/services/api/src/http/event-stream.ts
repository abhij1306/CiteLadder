import { getLogger } from '../logging.ts';
import { waitForPoll } from '../workers/poll.ts';
import { RequestValidationError } from './params.ts';
import { parseUuid } from './uuid.ts';

const logger = getLogger('api.event_stream');

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

type EventFrame = { id: string; event: string; data: unknown };

export type SubjectState = 'open' | 'terminal' | 'gone';

export type EventTail = {
  stream: string;
  subjectId: string;
  after: string | undefined;
  first?: readonly EventFrame[];
  page: (after: string | undefined) => Promise<readonly EventFrame[]>;
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
      if (signal.aborted || Date.now() >= deadline) return;
      cursor = event.id;
      yield encodeFrame(event);
    }
    if (events.length >= settings.pageSize) continue;
    const state = await tail.poll();
    if (state === 'gone') return;
    if (state === 'terminal' && ++terminalPolls >= settings.terminalGracePolls) return;
    const delay = Math.min(settings.pollSeconds * 1000, Math.max(0, deadline - Date.now()));
    await waitForPoll(delay, signal); // NOSONAR
  }
}

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

export function eventStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}
