import { describe, expect, it } from 'vitest';
import {
  createDataforseoClient,
  searchPayload,
  searchPolicy,
  searchSettings,
  type SearchRequest,
} from '../src/search-surfaces/dataforseo.ts';
import { reconcilePage } from '../src/search-surfaces/reconciliation.ts';
import { providerSettings } from '../src/providers/config.ts';
const request: SearchRequest = {
  query: 'C++ choices at 50% off?',
  location_code: 2840,
  language_code: 'en',
  device: 'desktop',
  depth: 10,
  load_async_ai_overview: true,
  timeout_seconds: 1,
  provider_submission_ref: 'audit:task:engine',
  request_settings: { force_web_search: true, priority: 1 },
};
const client = (send: typeof fetch) =>
  createDataforseoClient(
    { secret: JSON.stringify({ login: 'test-user', password: 'test-password' }), base_url: '' },
    providerSettings({}),
    1,
    send,
  );
describe('DataForSEO paid submission boundary', () => {
  it.each(['0', '-1'])(
    'rejects a nonpositive request timeout %s at configuration admission',
    (timeout) => {
      expect(() => searchSettings({ DATAFORSEO_REQUEST_TIMEOUT_SECONDS: timeout })).toThrow();
    },
  );
  it('accepts a positive fractional request timeout', () => {
    expect(searchSettings({ DATAFORSEO_REQUEST_TIMEOUT_SECONDS: '0.5' }).timeoutSeconds).toBe(0.5);
  });
  it('submits the exact frozen tag and losslessly escaped query, retaining the accepted charge', async () => {
    const c = client(async (url, options) => {
      expect(url).toBe('https://api.dataforseo.com/v3/serp/google/organic/task_post');
      expect(JSON.parse(String(options?.body))).toEqual([
        {
          keyword: 'C%2B%2B choices at 50%25 off?',
          tag: request.provider_submission_ref,
          location_code: 2840,
          language_code: 'en',
          device: 'desktop',
          os: 'windows',
          depth: 10,
          load_async_ai_overview: true,
        },
      ]);
      expect(options?.redirect).toBe('error');
      return Response.json({
        status_code: 20000,
        tasks: [{ id: 'paid-task', status_code: 20100, cost: 0.0012 }],
      });
    });
    expect(await c.submit('google_ai_overview', request)).toMatchObject({
      taskId: 'paid-task',
      chargeMicrousd: 1200,
    });
  });
  it('keeps accepted submissions without IDs and ambiguous transport failures uncertain, with no retries', async () => {
    let calls = 0;
    await expect(
      client(async () => {
        calls++;
        throw new Error('secret transport detail');
      }).submit('chatgpt_search', request),
    ).rejects.toMatchObject({ code: 'submission_uncertain', retryable: false });
    expect(calls).toBe(1);
    await expect(
      client(async () =>
        Response.json({ status_code: 20000, tasks: [{ status_code: 20100, cost: 0.004 }] }),
      ).submit('chatgpt_search', request),
    ).rejects.toMatchObject({ submission: { taskId: null, chargeMicrousd: 4000 } });
  });
  it('recognizes body-level refusal before interpreting any task stub', async () => {
    await expect(
      client(async () =>
        Response.json({
          status_code: 40100,
          status_message: 'must-not-echo',
          tasks: 'malformed-task-stub',
        }),
      ).submit('google_ai_overview', request),
    ).rejects.toMatchObject({
      code: 'auth_failure',
      message: 'Provider execution failed: auth_failure',
    });
    await expect(
      client(async () =>
        Response.json({ status_code: 20000, tasks: [{ status_code: 40200 }] }),
      ).submit('google_ai_overview', request),
    ).rejects.toMatchObject({ code: 'client_error' });
  });
  it('retrieves for free using only the committed ID', async () => {
    let calls = 0;
    const result = await client(async (url, options) => {
      calls++;
      expect(url).toBe(
        'https://api.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/task_get/advanced/paid-task',
      );
      expect(options?.method).toBe('GET');
      expect(options?.body).toBeUndefined();
      return Response.json({
        status_code: 20000,
        tasks: [{ status_code: 40602, id: 'paid-task' }],
      });
    }).retrieve('gemini_consumer', 'paid-task');
    expect(result.tasks?.[0]?.status_code).toBe(40602);
    expect(calls).toBe(1);
  });
  it('rejects an overlong escaped query without truncation or provider I/O', () => {
    expect(() =>
      searchPayload('google_ai_overview', {
        ...request,
        query: '+'.repeat(searchPolicy.constants.keyword_max_chars),
      }),
    ).toThrow('keyword_too_long');
    expect(() =>
      searchPayload('google_ai_overview', { ...request, location_code: 999999 }),
    ).toThrow('invalid_search_context');
    expect(() => searchSettings({ DATAFORSEO_RECOVERY_DEADLINE_HOURS: String(24 * 28) })).toThrow();
  });
  it('requires exact product and tag, preserving matches across pages and binding at the page bound', () => {
    const row = {
      id: 'paid-task',
      cost: 0.004,
      metadata: {
        tag: request.provider_submission_ref,
        api: 'ai_optimization',
        se: 'chat_gpt',
        function: 'llm_scraper',
      },
    };
    const page = {
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            { ...row, id: 'wrong-product', metadata: { ...row.metadata, se: 'gemini' } },
            {
              ...row,
              id: 'wrong-tag',
              metadata: { ...row.metadata, tag: 'prefix' + request.provider_submission_ref },
            },
            row,
          ],
        },
      ],
    };
    const result = reconcilePage(page, 'chatgpt_search', request.provider_submission_ref, {
      offset: 0,
      matches: {},
      upper: '2026-09-30T00:00:00Z',
    });
    expect(result.match).toEqual({ id: 'paid-task', chargeMicrousd: 4000 });
    const full = {
      status_code: 20000,
      tasks: [
        { status_code: 20000, result: Array(searchPolicy.constants.reconcile_page_size).fill(row) },
      ],
    };
    const partial = reconcilePage(full, 'chatgpt_search', request.provider_submission_ref, {
      offset: 0,
      matches: {},
      upper: '2026-09-30T00:00:00Z',
    });
    expect(partial.match).toBeNull();
    expect(partial.state.matches).toEqual({ 'paid-task': 4000 });
    expect(
      reconcilePage(full, 'chatgpt_search', request.provider_submission_ref, {
        ...partial.state,
        offset:
          (searchPolicy.scraper.reconcile_max_pages - 1) *
          searchPolicy.constants.reconcile_page_size,
      }).match,
    ).toEqual({ id: 'paid-task', chargeMicrousd: 4000 });
    expect(
      reconcilePage(
        { ...page, tasks: [{ status_code: 20000, result: [row, { ...row, id: 'duplicate' }] }] },
        'chatgpt_search',
        request.provider_submission_ref,
        { offset: 0, matches: {}, upper: '' },
      ).ambiguous,
    ).toBe(true);
  });
});
