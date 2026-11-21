import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { agentTurnEventSchema } from '@citeladder/contracts/agent';
import { activityRows, callStep } from './activity';
import {
  applyTurnEvent,
  liveTurn,
  onLiveTurnClosed,
  startLiveTurn,
  useLiveDocumentBody,
  useLiveTurn,
  type TurnEvent,
} from './live-turns';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CHAT = '11111111-1111-4111-8111-111111111111';

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
  await vi.waitFor(() => expect(result.current?.reply).toEqual([{ ordinal: 1, text: 'Hello' }]));
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

it('appends each call’s reply and thinking to its own segment, so earlier text never changes', () => {
  const turn = fold([
    { type: 'step', ordinal: 1 },
    { type: 'thinking', ordinal: 1, text: 'Checking ' },
    { type: 'thinking', ordinal: 1, text: 'the data' },
    { type: 'reply_delta', ordinal: 1, text: 'Reading ' },
    { type: 'reply_delta', ordinal: 1, text: 'first.' },
    { type: 'step', ordinal: 2 },
    { type: 'thinking', ordinal: 2, text: 'Now answer' },
    { type: 'reply_delta', ordinal: 2, text: 'Ans' },
    { type: 'reply_delta', ordinal: 2, text: 'wer' },
  ]);
  expect(turn).toMatchObject({
    step: 2,
    thinking: [
      { ordinal: 1, text: 'Checking the data' },
      { ordinal: 2, text: 'Now answer' },
    ],
    reply: [
      { ordinal: 1, text: 'Reading first.' },
      { ordinal: 2, text: 'Answer' },
    ],
  });
});

it('tracks each parallel call by its id and target, and keeps the newest document snapshot', () => {
  const turn = fold(
    [
      {
        type: 'tool',
        ordinal: 1,
        call_id: 'a',
        tool: 'read_page_text',
        status: 'started',
        target: 'https://acme.example/returns',
      },
      { type: 'tool', ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'started' },
      { type: 'tool', ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'unavailable' },
      { type: 'document_delta', ordinal: 2, title: 'Plan', from: 0, text: 'Draft' },
      { type: 'document_delta', ordinal: 2, title: 'Plan', from: 5, text: ' with more' },
    ].map((event) => agentTurnEventSchema.parse(event)),
  );
  expect(turn.tools).toEqual([
    {
      ordinal: 1,
      call_id: 'a',
      tool: 'read_page_text',
      status: 'started',
      target: 'https://acme.example/returns',
    },
    { ordinal: 1, call_id: 'b', tool: 'read_performance', status: 'unavailable', target: null },
  ]);
  expect(
    activityRows(turn.tools.map(callStep)).map(({ verb, noun, detail }) => [verb, noun, detail]),
  ).toEqual([
    ['Reading', 'page', 'https://acme.example/returns'],
    ['Read', 'search performance', 'no data yet'],
  ]);
  expect(turn.document).toEqual({ title: 'Plan', body: 'Draft with more' });
});

it('rebuilds the document from deltas, resets it on a full snapshot and ignores a gap', () => {
  const doc = (from: number, text: string): TurnEvent => ({
    type: 'document_delta',
    ordinal: 2,
    title: 'Plan',
    from,
    text,
  });
  expect(fold([doc(0, 'One'), doc(3, ' two'), doc(7, ' three')]).document?.body).toBe(
    'One two three',
  );
  expect(fold([doc(0, 'One'), doc(3, ' two'), doc(0, 'Rewritten')]).document?.body).toBe(
    'Rewritten',
  );
  expect(fold([doc(0, 'One'), doc(9, ' lost'), doc(3, ' two')]).document?.body).toBe('One two');
});

function fedStream() {
  const encoder = new TextEncoder();
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      feed = controller;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    send: (...events: TurnEvent[]) =>
      feed.enqueue(encoder.encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))),
    close: () => feed.close(),
  };
}

function heldFrames(stream: ReturnType<typeof fedStream>) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const frames: FrameRequestCallback[] = [];
  let asked = () => {};
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    asked();
    return frames.push(callback);
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(stream.response)),
  );
  const requested = () =>
    new Promise<void>((resolve) => {
      asked = resolve;
    });
  return { frames, requested };
}

const closed = () =>
  new Promise<void>((resolve) => {
    const stop = onLiveTurnClosed(() => {
      stop();
      resolve();
    });
  });

it('tells listeners once a frame, and at once with the folded events when the stream closes', async () => {
  const run = '22222222-2222-4222-8222-222222222204';
  const stream = fedStream();
  const { frames, requested } = heldFrames(stream);
  startLiveTurn(CHAT, run, null);
  let renders = 0;
  const { result } = renderHook(() => {
    renders += 1;
    return useLiveTurn(run);
  });
  const events: TurnEvent[] = [
    { type: 'step', ordinal: 1 },
    { type: 'reply_delta', ordinal: 1, text: 'Hel' },
    { type: 'reply_delta', ordinal: 1, text: 'lo' },
  ];

  const asked = requested();
  stream.send(...events);
  await asked;
  expect(renders).toBe(1);
  act(() => frames[0]?.(0));
  expect(renders).toBe(2);

  const last: TurnEvent = { type: 'reply_delta', ordinal: 1, text: '!' };
  const ended = closed();
  await act(async () => {
    stream.send(last);
    stream.close();
    await ended;
  });
  expect(frames).toHaveLength(2);
  expect(result.current).toEqual({
    ...fold([...events, last]),
    startedAt: expect.any(Number),
    connected: false,
  });
});

it('re-renders a document reader only when the streamed body changes', async () => {
  const run = '22222222-2222-4222-8222-222222222205';
  const stream = fedStream();
  const { frames, requested } = heldFrames(stream);
  startLiveTurn(CHAT, run, null);
  const renders = { body: 0, turn: 0 };
  const body = renderHook(() => {
    renders.body += 1;
    return useLiveDocumentBody(run);
  });
  renderHook(() => {
    renders.turn += 1;
    return useLiveTurn(run);
  });
  const paint = async (event: TurnEvent) => {
    const asked = requested();
    stream.send(event);
    await asked;
    act(() => frames.at(-1)?.(0));
  };

  await paint({ type: 'reply_delta', ordinal: 1, text: 'Writing' });
  expect(renders).toEqual({ body: 1, turn: 2 });
  await paint({ type: 'document_delta', ordinal: 1, title: 'Plan', from: 0, text: 'Draft' });
  expect(renders).toEqual({ body: 2, turn: 3 });
  expect(body.result.current).toBe('Draft');
  const ended = closed();
  await act(async () => {
    stream.close();
    await ended;
  });
});
