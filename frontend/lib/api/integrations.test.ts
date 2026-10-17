import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { integrationsApi } from './integrations';
import {
  integrationConnectionSchema,
  integrationSyncRunSchema,
} from '@citeladder/contracts/integrations';
import { strictValidate } from '@citeladder/contracts/validation';
import { mswServer } from '@/test/msw-server';

const WS = '11111111-1111-4111-8111-111111111111';
const GRANT = '22222222-2222-4222-8222-222222222222';
const CONN = '33333333-3333-4333-8333-333333333333';
const SYNC = '44444444-4444-4444-8444-444444444444';

// Fixture shape: a connection joined to grant status + granted scopes, NEVER a
// token field.
const connection = {
  id: CONN,
  workspace_id: WS,
  grant_id: GRANT,
  provider: 'gsc' as const,
  label: 'acme-outdoor.example GSC',
  account_ref: 'sc-domain:acme-outdoor.example',
  grant_status: 'connected' as const,
  granted_scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  last_synced_at: '2026-07-22T00:00:00Z',
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-22T00:00:00Z',
};

const syncRun = {
  id: SYNC,
  connection_id: CONN,
  sync_kind: 'on_demand' as const,
  status: 'queued' as const,
  window_start: '2026-07-16',
  window_end: '2026-07-22',
  row_count: 0,
  processing: false,
  resync_seq: 1,
  error_code: '',
  error_detail: '',
  created_at: '2026-07-22T00:00:00Z',
  updated_at: '2026-07-22T00:00:00Z',
  completed_at: null,
};

const enqueue = {
  sync_run_id: SYNC,
  connection_id: CONN,
  status: 'queued' as const,
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('integrationsApi.list', () => {
  it('validates the connection list joined to grant status + scopes', async () => {
    mswServer.use(http.get('/api/v1/integrations', () => HttpResponse.json([connection])));
    const items = await integrationsApi.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.provider).toBe('gsc');
    expect(items[0]?.grant_status).toBe('connected');
    expect(items[0]?.granted_scopes).toEqual([
      'https://www.googleapis.com/auth/webmasters.readonly',
    ]);
    expect(items[0]?.last_synced_at).toBe('2026-07-22T00:00:00Z');
  });

  it('rejects a leaked access_token', async () => {
    mswServer.use(
      http.get('/api/v1/integrations', () =>
        HttpResponse.json([{ ...connection, access_token: 'ya29.leaked' }]),
      ),
    );
    await expect(integrationsApi.list()).rejects.toThrow('API validation failure');
  });

  it('rejects a leaked refresh_token', async () => {
    mswServer.use(
      http.get('/api/v1/integrations', () =>
        HttpResponse.json([{ ...connection, refresh_token: '1//leaked' }]),
      ),
    );
    await expect(integrationsApi.list()).rejects.toThrow('API validation failure');
  });

  it('retains non-token additive response fields', async () => {
    mswServer.use(
      http.get('/api/v1/integrations', () =>
        HttpResponse.json([{ ...connection, additive_status: 'ready' }]),
      ),
    );
    const items = await integrationsApi.list();
    expect(items[0]).toMatchObject({ additive_status: 'ready' });
  });
});

describe('integrationsApi.test', () => {
  it('posts to the probe route and validates the result', async () => {
    let seenPath = '';
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/test`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({
          connection_id: CONN,
          status: 'ok',
          error_code: '',
          detail: '',
          tested_at: '2026-07-22T01:00:00Z',
        });
      }),
    );
    const result = await integrationsApi.test(CONN);
    expect(result.status).toBe('ok');
    expect(result.error_code).toBe('');
    expect(seenPath).toBe(`/api/v1/integrations/${CONN}/test`);
  });

  it('surfaces a failed probe with its error_code', async () => {
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/test`, () =>
        HttpResponse.json({
          connection_id: CONN,
          status: 'failed',
          error_code: 'auth_failed',
          detail: 'provider rejected the grant token',
          tested_at: '2026-07-22T01:00:00Z',
        }),
      ),
    );
    const result = await integrationsApi.test(CONN);
    expect(result.status).toBe('failed');
    expect(result.error_code).toBe('auth_failed');
  });
});

describe('integrationsApi.sync + sync-run projections', () => {
  it('posts the optional window body and validates the 202 enqueue (C3)', async () => {
    let seenBody: unknown;
    mswServer.use(
      http.post(`/api/v1/integrations/${CONN}/sync`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(enqueue, { status: 202 });
      }),
    );
    const queued = await integrationsApi.sync(CONN, {
      window_start: '2026-07-16',
      window_end: '2026-07-22',
    });
    expect(queued.sync_run_id).toBe(SYNC);
    expect(queued.connection_id).toBe(CONN);
    expect(queued.status).toBe('queued');
    expect(seenBody).toEqual({ window_start: '2026-07-16', window_end: '2026-07-22' });
  });

  it('gets a single sync-run projection for polling', async () => {
    mswServer.use(
      http.get(`/api/v1/integrations/${CONN}/syncs/${SYNC}`, () =>
        HttpResponse.json({ ...syncRun, status: 'running', row_count: 400 }),
      ),
    );
    const run = await integrationsApi.getSync(CONN, SYNC);
    expect(run.id).toBe(SYNC);
    expect(run.status).toBe('running');
    expect(run.row_count).toBe(400);
  });

  it('retains a safe additive key in a sync-run projection', async () => {
    mswServer.use(
      http.get(`/api/v1/integrations/${CONN}/syncs/${SYNC}`, () =>
        HttpResponse.json({ ...syncRun, idempotency_key: 'internal-only' }),
      ),
    );
    const run = await integrationsApi.getSync(CONN, SYNC);
    expect(run.id).toBe(SYNC);
    expect(run).toMatchObject({ idempotency_key: 'internal-only' });
  });
});

describe('integrationsApi.delete + oauthStartUrl', () => {
  it('deletes the connection (204)', async () => {
    let seenPath = '';
    mswServer.use(
      http.delete(`/api/v1/integrations/${CONN}`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(integrationsApi.delete(CONN)).resolves.toBeUndefined();
    expect(seenPath).toBe(`/api/v1/integrations/${CONN}`);
  });

  it('builds the relative same-origin OAuth start URL for window navigation', () => {
    const url = integrationsApi.oauthStartUrl('gsc', WS);
    expect(url).toBe(`/api/v1/integrations/workspaces/${WS}/oauth/gsc/start`);
    // Never an absolute/cross-origin URL.
    expect(url.startsWith('/')).toBe(true);
    expect(integrationsApi.oauthStartUrl('ga4', WS)).toBe(
      `/api/v1/integrations/workspaces/${WS}/oauth/ga4/start`,
    );
    expect(integrationsApi.oauthStartUrl('bing', WS)).toBe(
      `/api/v1/integrations/workspaces/${WS}/oauth/bing/start`,
    );
  });
});

describe('integrations schemas (drift policy)', () => {
  it('rejects an unknown provider', () => {
    expect(() =>
      strictValidate(integrationConnectionSchema, { ...connection, provider: 'bing_ads' }, 'test'),
    ).toThrow(/test/);
  });

  it('rejects an unknown grant status', () => {
    expect(() =>
      strictValidate(
        integrationConnectionSchema,
        { ...connection, grant_status: 'expired' },
        'test',
      ),
    ).toThrow(/test/);
  });

  it('rejects a non-uuid connection id', () => {
    expect(() =>
      strictValidate(integrationConnectionSchema, { ...connection, id: 'conn-1' }, 'test'),
    ).toThrow(/test/);
  });

  it('rejects an unknown sync-run status', () => {
    expect(() =>
      strictValidate(integrationSyncRunSchema, { ...syncRun, status: 'provisioning' }, 'test'),
    ).toThrow(/test/);
  });
});
