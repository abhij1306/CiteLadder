import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { createAppQueryClient } from './query-client';
import type { AuditLaunchRequest } from '@citeladder/contracts/audit-requests';
import { runsQueries } from './runs';

const WORKSPACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LAUNCH: AuditLaunchRequest = {
  project_id: '11111111-1111-4111-8111-111111111111',
  prompt_set_id: '22222222-2222-4222-8222-222222222222',
  engines: ['chatgpt'],
  repetitions: 1,
  audit_scope: 'brand',
};

beforeAll(() => mswServer.listen({ onUnhandledFrame: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('the launch estimate', () => {
  it('is asked for again in another workspace rather than served from the first', async () => {
    const payers: (string | null)[] = [];
    mswServer.use(
      http.post('/api/v1/audits/estimate', ({ request }) => {
        const payer = request.headers.get('X-Workspace-Id');
        payers.push(payer);
        return HttpResponse.json({
          retrieval_enabled: false,
          prompt_count: payer === WORKSPACE_A ? 3 : 7,
          engine_count: 1,
          repetition_count: 1,
          market_count: 1,
          execution_count: 3,
          maximum_attempt_count: 3,
          maximum_wall_clock_seconds: 60,
          cost_status: 'unknown',
          estimated_total_cost_microusd: null,
          engines: [],
        });
      }),
    );
    const client = createAppQueryClient();

    const first = await client.fetchQuery(runsQueries.estimate(WORKSPACE_A, LAUNCH));
    const second = await client.fetchQuery(runsQueries.estimate(WORKSPACE_B, LAUNCH));

    expect(payers).toEqual([WORKSPACE_A, WORKSPACE_B]);
    expect([first.prompt_count, second.prompt_count]).toEqual([3, 7]);
  });
});
