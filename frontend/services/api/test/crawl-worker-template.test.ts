import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../../public/templates/citeladder-crawl-log-worker.js';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const env = {
  CITELADDER_INGEST_URL: 'https://citeladder.test/ingest',
  CITELADDER_CRAWL_TOKEN: 'secret',
};
const start = Date.parse('2026-10-09T00:00:00Z');
/** The origin answers a Request; the ingest endpoint answers its URL string. */
function stubFetch(ingest: () => Promise<Response>) {
  const fetch = vi.fn(async (input: Request | string, _init?: RequestInit) =>
    typeof input === 'string' ? ingest() : new Response('visitor content', { status: 404 }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function visit(at: number, headers: Record<string, string>, path = '/page?secret=remove') {
  vi.setSystemTime(at);
  const work: Promise<void>[] = [];
  const response = await worker.fetch(
    new Request('https://example.test' + path, { headers }),
    env,
    {
      waitUntil: (promise: Promise<void>) => work.push(promise),
    },
  );
  await Promise.all(work);
  return { response, sent: work.length };
}
describe('customer Worker delivery', () => {
  it('buffers recognized requests and sends one batch once the oldest has waited', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetch = stubFetch(async () => new Response(null, { status: 429 }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await visit(start, {
      'user-agent': 'GPTBot/1.0',
      'cf-connecting-ip': '192.0.2.1',
      'cf-ray': 'a1b2c3-LAX',
    });
    expect(first.sent).toBe(0);
    expect(await first.response.text()).toBe('visitor content');
    expect((await visit(start + 59000, { 'user-agent': 'Mozilla/5.0' })).sent).toBe(0);
    const due = await visit(start + 60000, { 'user-agent': 'ChatGPT-User/1.0' }, '/second');
    expect(due.sent).toBe(1);
    expect(due.response.status).toBe(404);
    const [url, init] = fetch.mock.calls.find(([input]) => typeof input === 'string')!;
    expect(url).toBe(env.CITELADDER_INGEST_URL);
    const lines = String(init!.body)
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toMatchObject([
      { path: '/page', status: 404, request_id: 'a1b2c3', user_agent: 'GPTBot/1.0' },
      { path: '/second', status: 404, request_id: null, user_agent: 'ChatGPT-User/1.0' },
    ]);
    expect(error).toHaveBeenCalledWith('CiteLadder crawl log delivery failed', 429);
  });
  it('sends nothing for unrecognized traffic and tolerates a failed send', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetch = stubFetch(async () => {
      throw new Error('network');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await visit(start, { 'user-agent': 'Mozilla/5.0' })).sent).toBe(0);
    await visit(start, { 'user-agent': 'PerplexityBot/1.0' });
    const due = await visit(start + 60000, { 'user-agent': 'Mozilla/5.0' });
    expect(due.sent).toBe(1);
    expect(await due.response.text()).toBe('visitor content');
    expect(fetch.mock.calls.filter(([input]) => typeof input === 'string')).toHaveLength(1);
    expect(error).toHaveBeenCalledWith('CiteLadder crawl log delivery failed');
  });
});
