import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import {
  eventFrames,
  eventTailStream,
  resumeCursor,
  type EventTail,
  type SubjectState,
} from '../src/http/event-stream.ts';
import { RequestValidationError } from '../src/http/params.ts';

const ID = '018f4f6e-1c2d-7a3b-8c4d-5e6f7a8b9c0d';

/** A tail over `count` numbered events, served `pageSize` at a time, and how often it was read. */
function numberedTail(
  count: number,
  options: { pageSize: number; states?: SubjectState[]; maxSeconds?: number },
) {
  const reads = { pages: 0, polls: 0 };
  const states = [...(options.states ?? [])];
  const tail: EventTail = {
    stream: 'test',
    subjectId: 'subject',
    after: undefined,
    page: async (after) => {
      reads.pages++;
      const start = after === undefined ? 0 : Number(after);
      return Array.from(
        { length: Math.max(0, Math.min(options.pageSize, count - start)) },
        (_, i) => ({
          id: String(start + i + 1),
          event: 'progress',
          data: { n: start + i + 1 },
        }),
      );
    },
    poll: async () => {
      reads.polls++;
      return states.shift() ?? 'open';
    },
    settings: {
      pageSize: options.pageSize,
      pollSeconds: 0.001,
      maxSeconds: options.maxSeconds ?? 5,
      terminalGracePolls: 2,
    },
  };
  return { tail, reads };
}

async function collect(tail: EventTail) {
  const frames: string[] = [];
  for await (const frame of eventFrames(tail, new AbortController().signal)) frames.push(frame);
  return frames;
}

describe('event stream resume cursor', () => {
  it('reads the header first, then the query, accepting any UUID spelling', () => {
    expect(resumeCursor({ header: ID, query: 'ignored' })).toBe(ID);
    expect(resumeCursor({ header: '', query: `{${ID.toUpperCase()}}` })).toBe(ID);
  });

  it('reads an absent or empty id as no cursor', () => {
    expect(resumeCursor({ header: undefined, query: '' })).toBeUndefined();
    expect(resumeCursor({ header: '' })).toBeUndefined();
    expect(resumeCursor({ header: ID })).toBe(ID);
  });

  it.each([
    [{ header: 'bad' }, ['header', 'last-event-id']],
    [{ header: undefined, query: 'bad' }, ['query', 'last_event_id']],
  ])('refuses a malformed id at its source: %j', (input, loc) => {
    expect(() => resumeCursor(input)).toThrow(RequestValidationError);
    expect(() => resumeCursor(input)).toThrow(`${loc.join('.')}: Input should be a valid UUID`);
  });
});

describe('event tail', () => {
  it('writes each event as an SSE frame and ends after the terminal grace polls', async () => {
    const { tail } = numberedTail(3, { pageSize: 2, states: ['open', 'terminal', 'terminal'] });
    expect(await collect(tail)).toEqual([
      'id: 1\nevent: progress\ndata: {"n":1}\n\n',
      'id: 2\nevent: progress\ndata: {"n":2}\n\n',
      'id: 3\nevent: progress\ndata: {"n":3}\n\n',
    ]);
  });

  it('drains a backlog of full pages before polling the subject', async () => {
    const { tail, reads } = numberedTail(4, { pageSize: 2, states: ['gone'] });
    expect(await collect(tail)).toHaveLength(4);
    expect(reads).toEqual({ pages: 3, polls: 1 });
  });

  it('serves a prepared first page, then resumes after its last event', async () => {
    const { tail } = numberedTail(3, { pageSize: 5, states: ['open', 'gone'] });
    tail.after = '1';
    tail.first = [{ id: '2', event: 'progress', data: { n: 2 } }];
    expect(await collect(tail)).toEqual([
      'id: 2\nevent: progress\ndata: {"n":2}\n\n',
      'id: 3\nevent: progress\ndata: {"n":3}\n\n',
    ]);
  });

  it('stops at its maximum duration even while the subject stays open', async () => {
    const { tail } = numberedTail(0, { pageSize: 5, maxSeconds: 0.05 });
    const started = Date.now();
    expect(await collect(tail)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ends mid-page at its maximum duration when the reader falls behind', async () => {
    const { tail } = numberedTail(3, { pageSize: 5, maxSeconds: 0.05 });
    const frames = eventFrames(tail, new AbortController().signal);
    expect((await frames.next()).value).toBe('id: 1\nevent: progress\ndata: {"n":1}\n\n');
    await sleep(80);
    expect(await frames.next()).toEqual({ done: true, value: undefined });
  });

  it('reads the next page only when the consumer asks for more', async () => {
    const { tail, reads } = numberedTail(1000, { pageSize: 1 });
    const reader = eventTailStream(tail, new AbortController().signal).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('id: 1\nevent: progress\ndata: {"n":1}\n\n');
    await sleep(50);
    // A slow reader holds the server at one page ahead, not the whole backlog.
    expect(reads.pages).toBeLessThanOrEqual(2);
    await reader.cancel();
  });
});
