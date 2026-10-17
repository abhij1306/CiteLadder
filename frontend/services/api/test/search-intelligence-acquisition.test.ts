import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/answer-engines/contracts.ts';
import { resolveLive, sendLive } from '../src/search-intelligence/live.ts';
import { INT4_MAX, normalizeResponse } from '../src/search-intelligence/normalization.ts';

const input = {
  secret: JSON.stringify({ login: 'user', password: 'secret' }),
  endpoint: '/v3/dataforseo_labs/google/ranked_keywords/live',
  payload: { target: 'example.com' },
  baseUrl: '',
};
/** The executor's dispatch path: local checks first, then one send. */
const executeLive = async (live: typeof input, options: Parameters<typeof sendLive>[2]) =>
  sendLive(resolveLive(live), live.payload, options);
const body = (result: unknown, cost: unknown = 0.012) => ({
  status_code: 20000,
  cost: 99,
  tasks: [{ id: 'task', status_code: 20000, cost, result: [result] }],
});
const target = {
  registrable_domain: 'example.com',
  hostname: 'www.example.com',
  origin: 'https://www.example.com',
};
const plan = {
  target,
  research_scope: 'exact_host',
  request: { target: 'example.com', date_from: '2026-01-01', date_to: '2026-09-01' },
};
describe('single-dispatch research transport and scoped normalization', () => {
  it('sends once and keeps exact task cost ahead of the envelope total', async () => {
    let sent = 0;
    const response = await executeLive(input, {
      send: async (_url, options) => {
        sent++;
        expect(options?.redirect).toBe('error');
        expect(JSON.parse(String(options?.body))).toEqual([{ target: 'example.com' }]);
        return Response.json(body({ items: [] }));
      },
    });
    expect(sent).toBe(1);
    expect(response.cost).toBe('0.012');
    expect(response.taskId).toBe('task');
    await expect(
      executeLive(input, {
        send: async () => {
          sent++;
          throw new Error('secret provider body');
        },
      }),
    ).rejects.toMatchObject({ code: 'connection' });
    expect(sent).toBe(2);
  });
  it('refuses an unreadable credential or unknown endpoint without sending', async () => {
    let sent = 0;
    const send = async () => {
      sent++;
      return Response.json(body({ items: [] }));
    };
    await expect(executeLive({ ...input, secret: 'not-a-secret' }, { send })).rejects.toMatchObject(
      { code: 'auth_failure' },
    );
    expect(() => resolveLive({ ...input, endpoint: '/v3/unknown/live' })).toThrow(ProviderError);
    expect(() => resolveLive({ ...input, baseUrl: 'https://elsewhere.example' })).toThrow(
      ProviderError,
    );
    expect(sent).toBe(0);
  });
  it('preserves explicit rate limits and rejects malformed or oversized responses', async () => {
    await expect(
      executeLive(input, {
        send: async () => new Response('', { status: 429, headers: { 'retry-after': '7' } }),
      }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryAfterSeconds: 7 });
    await expect(
      executeLive(input, { send: async () => Response.json({ status_code: 20000, tasks: [] }) }),
    ).rejects.toMatchObject({ code: 'parse_error' });
    await expect(
      executeLive(input, { send: async () => new Response(' '.repeat(8 * 1024 * 1024 + 1)) }),
    ).rejects.toMatchObject({ code: 'parse_error' });
  });
  it.each([null, 42, true, ['task'], { id: 'task' }])(
    'retains receipts without inventing an ID from %j',
    async (id) => {
      const receipt = body({ items: [] });
      const malformed = { ...receipt, tasks: [{ ...receipt.tasks[0]!, id }] };
      const response = await executeLive(input, { send: async () => Response.json(malformed) });
      expect(response.taskId).toBe('');
      expect(response.cost).toBe('0.012');
      expect(response.body).toEqual(malformed);
    },
  );
  it('keeps scoped rows with unknown metrics and rejects another host', () => {
    const item = {
      keyword_data: {
        keyword: 'road shoes',
        keyword_info: { search_volume: 0 },
        keyword_properties: { keyword_difficulty: null },
      },
      ranked_serp_element: {
        serp_item: { type: 'organic', url: 'https://www.example.com/shoes', rank_group: 3 },
      },
    };
    const result = normalizeResponse(
      'ranking_keywords',
      body({ items: [item], total_count: 1 }),
      plan,
    );
    expect(result.rows[0]).toMatchObject({
      keyword: 'road shoes',
      search_volume: 0,
      difficulty: null,
      rank_group: 3,
      etv: null,
    });
    expect(() =>
      normalizeResponse(
        'ranking_keywords',
        body({
          items: [{ ...item, ranked_serp_element: { url: 'https://shop.example.com/shoes' } }],
        }),
        plan,
      ),
    ).toThrow('scope');
    expect(
      normalizeResponse(
        'ranking_keywords',
        body({
          items: [{ ...item, ranked_serp_element: { url: 'https://shop.example.com/shoes' } }],
        }),
        { ...plan, research_scope: 'domain_subdomains' },
      ).rows,
    ).toHaveLength(1);
  });
  it('fits provider values to their columns without losing them', () => {
    const item = {
      keyword_data: {
        keyword: 'shoes',
        search_intent_info: {
          foreign_intent: ['commercial', 'informational', 'navigational', 'transactional'],
        },
      },
      ranked_serp_element: { url: 'https://www.example.com/shoes' },
    };
    const total = INT4_MAX + 1;
    const result = normalizeResponse(
      'ranking_keywords',
      body({ items: [item], total_count: total }),
      plan,
    );
    expect(result.rows[0]?.intent).toBe('commercial, informational');
    expect([result.total, result.summary.provider_total]).toEqual([total, total]);
  });
  it('distinguishes empty evidence from unavailable results and enforces backlink/date scope', () => {
    expect(
      normalizeResponse('ranking_keywords', body({ items: [], total_count: 0 }), plan),
    ).toMatchObject({ summary: { result_available: true }, received: 0, total: 0 });
    expect(normalizeResponse('ranking_keywords', body(null), plan).summary.result_available).toBe(
      false,
    );
    expect(() =>
      normalizeResponse(
        'backlinks',
        body({ items: [{ url_to: 'https://www.example.com/a', domain_from: 'example.com' }] }),
        plan,
      ),
    ).toThrow('Internal');
    expect(() =>
      normalizeResponse('backlink_history', body({ items: [{ date: '2026-09-02' }] }), plan),
    ).toThrow('dates');
    expect(() =>
      normalizeResponse('backlink_summary', body({ target: 'other.example', backlinks: 3 }), plan),
    ).toThrow('scope');
  });
});
