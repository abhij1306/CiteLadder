import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { applyTurnEvent, liveTurn, startLiveTurn, useLiveTurn, type TurnEvent } from './live-turns';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CHAT = '11111111-1111-4111-8111-111111111111';

/** A stream that sends `chunks` and then stays open until the request aborts. */
function openStream(chunks: string[], signal: AbortSignal | null | undefined): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      signal?.addEventListener('abort', () => controller.error(signal.reason));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

it('re-posts the run after a 429 once Retry-After passes and shows the streamed reply', async () => {
  vi.useFakeTimers();
  const run = '22222222-2222-4222-8222-222222222201';
  const posts: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      posts.push(Date.now());
      if (posts.length === 1)
        return Promise.resolve(
          new Response('{"detail":"busy"}', { status: 429, headers: { 'retry-after': '1' } }),
        );
      return Promise.resolve(
        openStream(['data: {"type":"reply_delta","ordinal":1,"text":"Hello"}\n\n'], init?.signal),
      );
    }),
  );
  const start = Date.now();
  startLiveTurn(CHAT, run, null);
  const { result } = renderHook(() => useLiveTurn(run));

  await vi.advanceTimersByTimeAsync(999);
  expect(posts).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(result.current?.reply).toEqual({ ordinal: 1, text: 'Hello' }));
  expect(posts.map((at) => at - start)).toEqual([0, 1000]);
  expect(result.current?.connected).toBe(true);
});

it.each<[string, Record<string, string>]>([
  ['22222222-2222-4222-8222-222222222211', {}],
  ['22222222-2222-4222-8222-222222222212', { 'retry-after': '0' }],
  ['22222222-2222-4222-8222-222222222213', { 'retry-after': 'soon' }],
])(
  'waits the default 15 seconds before re-posting run %s refused with headers %j',
  async (run, headers) => {
    vi.useFakeTimers();
    const posts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        posts.push(Date.now());
        if (posts.length === 1)
          return Promise.resolve(new Response('{}', { status: 429, headers }));
        return Promise.resolve(openStream([], init?.signal));
      }),
    );
    const start = Date.now();
    startLiveTurn(CHAT, run, null);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(posts.map((at) => at - start)).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(posts.map((at) => at - start)).toEqual([0, 15_000]);
  },
);

it('closes a stream that sends no frame for twice the server heartbeat', async () => {
  vi.useFakeTimers();
  const run = '22222222-2222-4222-8222-222222222202';
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => Promise.resolve(openStream([], init?.signal))),
  );
  startLiveTurn(CHAT, run, null);
  const { result } = renderHook(() => useLiveTurn(run));

  await vi.advanceTimersByTimeAsync(29_999);
  expect(result.current?.connected).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => expect(result.current?.connected).toBe(false));
});

it('ends the live turn on a refusal other than 429 without re-posting', async () => {
  vi.useFakeTimers();
  const run = '22222222-2222-4222-8222-222222222203';
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response('{"detail":"gone"}', { status: 404 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  startLiveTurn(CHAT, run, null);
  const { result } = renderHook(() => useLiveTurn(run));

  await vi.waitFor(() => expect(result.current?.connected).toBe(false));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock.mock.calls).toHaveLength(1);
});

const fold = (events: TurnEvent[]) => events.reduce(applyTurnEvent, liveTurn(0));

it('appends one call’s reply and thinking, and lets a later call’s text replace them', () => {
  const turn = fold([
    { type: 'step', ordinal: 1 },
    { type: 'thinking', ordinal: 1, text: 'Checking ' },
    { type: 'thinking', ordinal: 1, text: 'the data' },
    { type: 'reply_delta', ordinal: 1, text: 'Reading ' },
    { type: 'reply_delta', ordinal: 1, text: 'first.' },
  ]);
  expect(turn).toMatchObject({
    step: 1,
    thinking: { ordinal: 1, text: 'Checking the data' },
    reply: { ordinal: 1, text: 'Reading first.' },
  });
  // A new call keeps the earlier text until it writes its own.
  const next = fold([
    { type: 'reply_delta', ordinal: 1, text: 'Reading first.' },
    { type: 'step', ordinal: 2 },
  ]);
  expect(next.reply).toEqual({ ordinal: 1, text: 'Reading first.' });
  expect(applyTurnEvent(next, { type: 'reply_delta', ordinal: 2, text: 'Answer' }).reply).toEqual({
    ordinal: 2,
    text: 'Answer',
  });
});

it('tracks each parallel call by its id and keeps the newest document snapshot', () => {
  const turn = fold([
    { type: 'tool', ordinal: 1, call_id: 'a', tool: 'read_site_health', status: 'started' },
    { type: 'tool', ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'started' },
    { type: 'tool', ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'unavailable' },
    { type: 'document_delta', ordinal: 2, title: 'Plan', body: 'Draft' },
    { type: 'document_delta', ordinal: 2, title: 'Plan', body: 'Draft with more' },
  ]);
  expect(turn.tools).toEqual([
    { ordinal: 1, call_id: 'a', tool: 'read_site_health', status: 'started' },
    { ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'unavailable' },
  ]);
  expect(turn.document).toEqual({ title: 'Plan', body: 'Draft with more' });
});
