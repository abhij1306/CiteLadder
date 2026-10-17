import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { aiTrafficApi } from './ai-traffic';

const projectId = '11111111-1111-4111-8111-111111111111';
const dashboard = {
  project_id: projectId,
  window_start: '2026-08-01',
  window_end: '2026-08-07',
  granularity: 'day',
  referral_volume: [],
  referral_share: [],
  sources: [],
  analyzer_version: 'ai-traffic-v2',
  formula_version: 'ai-referral-sessions-v2',
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('aiTrafficApi', () => {
  it('uses the focused persisted endpoint and validates its compact response', async () => {
    let requested = '';
    mswServer.use(
      http.get(`/api/v1/projects/${projectId}/ai-traffic/referrals`, ({ request }) => {
        requested = request.url;
        return HttpResponse.json(dashboard);
      }),
    );
    expect(await aiTrafficApi.getDashboard(projectId, { granularity: 'day' })).toMatchObject(
      dashboard,
    );
    expect(new URL(requested).searchParams.get('granularity')).toBe('day');
  });

  it('rejects impossible source totals from a drifted response', async () => {
    mswServer.use(
      http.get(`/api/v1/projects/${projectId}/ai-traffic/referrals`, () =>
        HttpResponse.json({
          ...dashboard,
          sources: [{ ai_source: 'chatgpt', sessions: -1, share: 1.1 }],
        }),
      ),
    );

    await expect(aiTrafficApi.getDashboard(projectId)).rejects.toThrow();
  });
});
