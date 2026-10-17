import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { actionsApi } from './actions';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTION = '22222222-2222-4222-8222-222222222222';
const REVISION = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-25T10:00:00Z';

const declaration = {
  id: '55555555-5555-4555-8555-555555555555',
  action_id: ACTION,
  output_revision_id: REVISION,
  member_opportunity_ids: [],
  opportunity_snapshot_id: SNAPSHOT,
  target_site_url_ids: [],
  target_external_url: null,
  declared_implemented_at: NOW,
  expected_checks: [
    {
      kind: 'traffic_metric',
      metric: 'clicks',
      direction: 'increase',
      expected_value: 1,
      tolerance: 0,
    },
  ],
  state: 'declared',
  limitations: [],
  verification_events: [],
  legs: [
    {
      leg: 'next_search_console_window',
      state: 'waiting',
      due_at: '2026-10-26T00:00:00Z',
      last_evidence_at: null,
      source_id: null,
    },
  ],
  checks: [],
  measured_until: NOW,
  created_at: NOW,
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('Action declaration', () => {
  it('sends only the revision and time, keyed for a safe retry', async () => {
    const seen: { key: string | null; body: unknown }[] = [];
    mswServer.use(
      http.post(`/api/v1/actions/${ACTION}/declaration`, async ({ request }) => {
        seen.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        return HttpResponse.json(declaration, { status: 201 });
      }),
    );
    const stored = await actionsApi.declare(
      ACTION,
      { output_revision_id: REVISION, declared_implemented_at: NOW },
      'declare-once',
      { workspaceId: WORKSPACE },
    );

    expect(seen).toEqual([
      {
        key: 'declare-once',
        body: { output_revision_id: REVISION, declared_implemented_at: NOW },
      },
    ]);
    expect(stored.legs[0]?.state).toBe('waiting');
  });
});
