import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { IntegrationClient } from '../src/integrations/client.ts';
import { freshAccessToken } from '../src/integrations/tokens.ts';
import * as integrationSync from '../src/integrations/sync.ts';
import { seedProject } from './referral-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { Fixtures } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new Fixtures(db);
let ownerId: string;
let workspaceId: string;
let connectionId: string;
let foreignConnectionId: string;
let projectId: string;
const projectConnections: string[] = [];

async function grant(workspace: string, transport: 'google_oauth' | 'microsoft_oauth') {
  const grantId = randomUUID();
  const now = new Date();
  await db
    .insertInto('integration_oauth_grants')
    .values({
      id: grantId,
      workspace_id: workspace,
      transport,
      access_token_encrypted: 'ciphertext',
      refresh_token_encrypted: 'ciphertext',
      token_expires_at: null,
      token_revision: 1,
      refresh_claim_id: null,
      refresh_claim_expires_at: null,
      granted_scopes: JSON.stringify([]),
      status: 'connected',
      created_at: now,
      updated_at: now,
    })
    .execute();
  return grantId;
}

async function connection(
  workspace: string,
  grantId: string,
  provider: 'gsc' | 'ga4' | 'bing',
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db
    .insertInto('integration_connections')
    .values({
      id,
      workspace_id: workspace,
      grant_id: grantId,
      provider,
      label: `Recorded ${provider}`,
      account_ref: `recorded-${provider}`,
      dataset_capabilities: JSON.stringify({}),
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}

async function mapToProject(connectionId: string, provider: 'gsc' | 'ga4' | 'bing') {
  await db
    .insertInto('integration_property_mappings')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      connection_id: connectionId,
      provider,
      property_ref: provider === 'ga4' ? '123456789' : 'https://example.test',
      project_id: projectId,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
}

async function get(path: string, selectedWorkspace = workspaceId, authenticated = true) {
  const headers: Record<string, string> = { 'x-workspace-id': selectedWorkspace };
  if (authenticated) {
    const token = await sessionToken({ sub: ownerId, ver: 0 });
    headers.cookie = `${TEST_SESSION_COOKIE}=${token}`;
  }
  const response = await app.request(path, { headers });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function discover(id: string, userId = ownerId, body?: { project_id: string }) {
  const token = await sessionToken({ sub: userId, ver: 0 });
  return app.request(`/api/v1/integrations/${id}/properties`, {
    method: 'POST',
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${token}`,
      'x-workspace-id': workspaceId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  ownerId = await fixtures.user();
  const foreignOwnerId = await fixtures.user();
  workspaceId = await fixtures.ownedWorkspace(ownerId);
  const foreignWorkspaceId = await fixtures.ownedWorkspace(foreignOwnerId);
  const googleGrant = await grant(workspaceId, 'google_oauth');
  const microsoftGrant = await grant(workspaceId, 'microsoft_oauth');
  const foreignGoogleGrant = await grant(foreignWorkspaceId, 'google_oauth');
  connectionId = await connection(workspaceId, googleGrant, 'gsc');
  foreignConnectionId = await connection(foreignWorkspaceId, foreignGoogleGrant, 'gsc');
  const ga4Connection = await connection(workspaceId, googleGrant, 'ga4');
  const bingConnection = await connection(workspaceId, microsoftGrant, 'bing');
  projectConnections.push(connectionId, ga4Connection, bingConnection);
  projectId = await seedProject(db, workspaceId);
  await mapToProject(connectionId, 'gsc');
  await mapToProject(ga4Connection, 'ga4');
  await mapToProject(bingConnection, 'bing');
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('integration connection routes', () => {
  it('rejects unknown or foreign property lookups before spending discovery quota', async () => {
    const before = await db
      .selectFrom('usage_windows')
      .select('id')
      .where('operation', '=', 'integrations.properties')
      .execute();
    expect((await discover(foreignConnectionId)).status).toBe(404);
    expect((await discover(randomUUID())).status).toBe(404);
    const after = await db
      .selectFrom('usage_windows')
      .select('id')
      .where('operation', '=', 'integrations.properties')
      .execute();
    expect(after).toEqual(before);
    const owned = await discover(connectionId);
    expect(owned.status).toBe(502);
    expect(await owned.json()).toMatchObject({ error: { code: 'grant_auth_failed' } });
  });

  it.each(['member', 'viewer', 'owner', 'admin'])(
    'gates %s discovery before provider I/O',
    async (role) => {
      // A workspace has one Owner: the owner case is the workspace's own.
      const userId = role === 'owner' ? ownerId : await fixtures.user();
      if (role !== 'owner') await fixtures.member(workspaceId, userId, role);
      const token = vi
        .spyOn(await import('../src/integrations/tokens.ts'), 'freshAccessToken')
        .mockResolvedValue('recorded-token');
      const provider = vi
        .spyOn(IntegrationClient.prototype, 'properties')
        .mockResolvedValue([{ property_ref: 'recorded', label: 'Recorded' }]);
      try {
        const result = await discover(connectionId, userId);
        const allowed = role === 'owner' || role === 'admin';
        expect(result.status).toBe(allowed ? 200 : 403);
        expect(provider).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(token).toHaveBeenCalledTimes(allowed ? 1 : 0);
      } finally {
        token.mockRestore();
        provider.mockRestore();
      }
    },
  );

  it('marks the properties that belong to the named project, and leaves GA4 unknown', async () => {
    const token = vi
      .spyOn(await import('../src/integrations/tokens.ts'), 'freshAccessToken')
      .mockResolvedValue('recorded-token');
    const provider = vi.spyOn(IntegrationClient.prototype, 'properties').mockResolvedValue([
      { property_ref: 'sc-domain:example.test', label: 'Domain' },
      { property_ref: 'https://www.example.test/', label: 'Prefix' },
      { property_ref: 'https://other.test/', label: 'Other site' },
    ]);
    try {
      const response = await discover(connectionId, ownerId, { project_id: projectId });
      expect(response.status).toBe(200);
      const properties = (await response.json()) as Array<{ matches_project: boolean | null }>;
      expect(properties.map((property) => property.matches_project)).toEqual([true, true, false]);
      const ga4 = await discover(projectConnections[1]!, ownerId, { project_id: projectId });
      const ga4Properties = (await ga4.json()) as Array<{ matches_project: boolean | null }>;
      expect(ga4Properties.every((property) => property.matches_project === null)).toBe(true);
      expect((await discover(connectionId, ownerId, { project_id: randomUUID() })).status).toBe(
        404,
      );
    } finally {
      token.mockRestore();
      provider.mockRestore();
    }
  });

  it('returns a failed OAuth start to the screen that began it, never off-site', async () => {
    const token = await sessionToken({ sub: ownerId, ver: 0 });
    const start = (returnTo: string) =>
      app.request(
        `/api/v1/integrations/workspaces/${workspaceId}/oauth/gsc/start?return_to=${encodeURIComponent(returnTo)}`,
        { headers: { cookie: `${TEST_SESSION_COOKIE}=${token}` } },
      );
    // Test configuration has no OAuth client, so the start fails before consent.
    const local = await start('/performance?range=28d&error=stale');
    expect(local.status).toBe(302);
    const location = new URL(local.headers.get('location')!);
    expect(location.pathname).toBe('/performance');
    expect(location.searchParams.get('range')).toBe('28d');
    expect(location.searchParams.getAll('error')).toEqual(['oauth_not_configured']);
    for (const hostile of ['//evil.test/performance', 'https://evil.test/performance', '/admin']) {
      const response = await start(hostile);
      const landed = new URL(response.headers.get('location')!);
      expect(landed.pathname).toBe('/settings');
      expect(landed.host).not.toBe('evil.test');
    }
  });

  it('disconnects a grant without deleting its imported evidence', async () => {
    const workspace = await fixtures.joinedWorkspace(ownerId);
    const project = await seedProject(db, workspace);
    const grantId = await grant(workspace, 'google_oauth');
    const gsc = await connection(workspace, grantId, 'gsc');
    const ga4 = await connection(workspace, grantId, 'ga4');
    const mappingIds = [randomUUID(), randomUUID()];
    for (const [index, [id, provider]] of [
      [gsc, 'gsc'],
      [ga4, 'ga4'],
    ].entries())
      await db
        .insertInto('integration_property_mappings')
        .values({
          id: mappingIds[index]!,
          workspace_id: workspace,
          connection_id: id!,
          provider: provider!,
          property_ref: provider === 'ga4' ? '123456789' : 'https://example.test',
          project_id: project,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    const run = await integrationSync.enqueueSyncRun(db, {
      workspaceId: workspace,
      connectionId: gsc,
      mappingId: mappingIds[0]!,
      projectId: project,
      windowStart: '2026-07-01',
      windowEnd: '2026-07-01',
      syncKind: 'backfill',
    });
    const artifactId = randomUUID();
    await db
      .insertInto('integration_import_artifacts')
      .values({
        id: artifactId,
        sync_run_id: run.sync_run_id,
        connection_id: gsc,
        workspace_id: workspace,
        provider: 'gsc',
        dataset: 'gsc_day_daily',
        query_snapshot: JSON.stringify({ startRow: 0 }),
        payload_hash: 'a'.repeat(64),
        row_count: 0,
        payload: JSON.stringify({ rows: [] }),
        fetched_at: new Date(),
        created_at: new Date(),
      })
      .execute();
    const token = await sessionToken({ sub: ownerId, ver: 0 });
    const response = await app.request(`/api/v1/integrations/${ga4}`, {
      method: 'DELETE',
      headers: { cookie: `${TEST_SESSION_COOKIE}=${token}`, 'x-workspace-id': workspace },
    });
    expect(response.status).toBe(204);
    // The whole grant is disconnected: both mappings retire, nothing is deleted.
    expect(
      (
        await db
          .selectFrom('integration_property_mappings')
          .select('status')
          .where('id', 'in', mappingIds)
          .execute()
      ).map((row) => row.status),
    ).toEqual(['disabled', 'disabled']);
    expect(
      await db
        .selectFrom('integration_import_artifacts')
        .select('id')
        .where('id', '=', artifactId)
        .execute(),
    ).toHaveLength(1);
    expect(
      await db
        .selectFrom('integration_connections')
        .select('id')
        .where('grant_id', '=', grantId)
        .execute(),
    ).toHaveLength(2);
    expect(
      (
        await db
          .selectFrom('integration_oauth_grants')
          .select('status')
          .where('id', '=', grantId)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('pending_revocation');
  });

  it('lets only credential managers bind or retire a property on the admin grant', async () => {
    const member = await fixtures.user();
    await fixtures.member(workspaceId, member, 'member');
    const headers = {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: member, ver: 0 })}`,
      'x-workspace-id': workspaceId,
      'content-type': 'application/json',
    };
    const saved = await app.request(`/api/v1/integrations/${connectionId}/mappings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'ga4', property_ref: '123456789', project_id: projectId }),
    });
    expect(saved.status).toBe(403);
    expect(
      await db
        .selectFrom('integration_property_mappings')
        .select('id')
        .where('connection_id', '=', connectionId)
        .where('property_ref', '=', '123456789')
        .execute(),
    ).toEqual([]);
    const mappingId = randomUUID();
    await db
      .insertInto('integration_property_mappings')
      .values({
        id: mappingId,
        workspace_id: workspaceId,
        connection_id: connectionId,
        provider: 'ga4',
        property_ref: '987654321',
        project_id: projectId,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    const retired = await app.request(`/api/v1/integrations/mappings/${mappingId}`, {
      method: 'DELETE',
      headers,
    });
    expect(retired.status).toBe(403);
    expect(
      (
        await db
          .selectFrom('integration_property_mappings')
          .select('status')
          .where('id', '=', mappingId)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('active');
    await db.deleteFrom('integration_property_mappings').where('id', '=', mappingId).execute();
  });

  it('reports a saved mapping whose history enqueue failed and allows retry without duplication', async () => {
    const token = await sessionToken({ sub: ownerId, ver: 0 });
    const save = () =>
      app.request(`/api/v1/integrations/${connectionId}/mappings`, {
        method: 'POST',
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'x-workspace-id': workspaceId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'gsc',
          property_ref: 'https://example.test',
          project_id: projectId,
        }),
      });
    const enqueue = vi
      .spyOn(integrationSync, 'enqueueHistoryBackfill')
      .mockRejectedValueOnce(new Error('recorded enqueue failure'));
    let failed;
    try {
      failed = await save();
    } finally {
      enqueue.mockRestore();
    }
    expect(failed.status).toBe(503);
    const retry = await save();
    expect(retry.status).toBe(201);
    const mapping = (await retry.json()) as { id: string };
    expect(
      await db
        .selectFrom('integration_property_mappings')
        .select('id')
        .where('connection_id', '=', connectionId)
        .where('project_id', '=', projectId)
        .where('status', '=', 'active')
        .execute(),
    ).toEqual([{ id: mapping.id }]);
    const runs = await db
      .selectFrom('integration_sync_runs')
      .select('id')
      .where('mapping_id', '=', mapping.id)
      .where('sync_kind', '=', 'backfill')
      .execute();
    expect(runs.length).toBeGreaterThan(0);
    // Other tests exercise the explicit Performance enqueue independently.
    await db.deleteFrom('integration_sync_runs').where('mapping_id', '=', mapping.id).execute();
  });

  it('fences a refresh when the last connection is disconnected during OAuth I/O', async () => {
    const workspace = await fixtures.joinedWorkspace(ownerId);
    const grantId = await grant(workspace, 'google_oauth');
    const connectionId = await connection(workspace, grantId, 'gsc');
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = new IntegrationClient(
      {
        [policy.settings.integration_google_client_id.env[0]!]: 'test-client',
        [policy.settings.integration_google_client_secret.env[0]!]: 'test-secret',
      },
      {
        async fetch() {
          started();
          await waiting;
          return new Response(
            JSON.stringify({
              access_token: 'rotated-access',
              refresh_token: 'rotated-refresh',
              expires_in: 3600,
            }),
            { status: 200 },
          );
        },
        sleep: async () => {},
      },
    );
    await db
      .updateTable('integration_oauth_grants')
      .set({
        access_token_encrypted: client.secrets.cipher.encrypt('old-access'),
        refresh_token_encrypted: client.secrets.cipher.encrypt('old-refresh'),
        token_expires_at: new Date(Date.now() - 1000),
      })
      .where('id', '=', grantId)
      .execute();
    const refresh = freshAccessToken(db, grantId, workspace, client).then(
      (token) => ({ token, error: null }),
      (error: unknown) => ({ token: null, error }),
    );
    await sent;
    try {
      const token = await sessionToken({ sub: ownerId, ver: 0 });
      const response = await app.request(`/api/v1/integrations/${connectionId}`, {
        method: 'DELETE',
        headers: { cookie: `${TEST_SESSION_COOKIE}=${token}`, 'x-workspace-id': workspace },
      });
      expect(response.status).toBe(204);
    } finally {
      release();
    }
    const result = await refresh;
    expect(result.error).toMatchObject({ code: 'grant_auth_failed' });
    const persisted = await db
      .selectFrom('integration_oauth_grants')
      .select(['status', 'token_revision', 'refresh_claim_id', 'access_token_encrypted'])
      .where('id', '=', grantId)
      .executeTakeFirstOrThrow();
    expect(persisted.status).toBe('pending_revocation');
    expect(persisted.token_revision).toBe(2);
    expect(persisted.refresh_claim_id).toBeNull();
    expect(client.secrets.cipher.decrypt(persisted.access_token_encrypted)).toBe('old-access');
  });

  it('lists only the active workspace connections', async () => {
    const result = await get('/api/v1/integrations');
    expect(result.status).toBe(200);
    const connections = result.body as { id: string; workspace_id: string }[];
    expect(connections.map((item) => item.id).sort()).toEqual([...projectConnections].sort());
    expect(connections.every((item) => item.workspace_id === workspaceId)).toBe(true);
  });

  it('enqueues every mapped provider, including Bing, for Performance sync, then tracks them on a repeat', async () => {
    const token = await sessionToken({ sub: ownerId, ver: 0 });
    const sync = () =>
      app.request(`/api/v1/projects/${projectId}/performance/sync`, {
        method: 'POST',
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'x-workspace-id': workspaceId,
        },
      });
    const response = await sync();
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      sync_run_id: string;
      connection_id: string;
      status: string;
    }[];
    expect(body.map((row) => row.connection_id).sort()).toEqual([...projectConnections].sort());
    expect(body.every((row) => row.status === 'queued')).toBe(true);
    // Every property still has its run in flight, so nothing new is queued and
    // the page tracks those same runs.
    const repeat = await sync();
    expect(repeat.status).toBe(202);
    const tracked = (await repeat.json()) as { sync_run_id: string }[];
    expect(tracked.map((row) => row.sync_run_id).sort()).toEqual(
      body.map((row) => row.sync_run_id).sort(),
    );
  });

  it('hides another workspace and its connections from a non-member', async () => {
    const foreign = await get(`/api/v1/integrations/${foreignConnectionId}/syncs`);
    expect(foreign.status).toBe(404);
    expect((await get('/api/v1/integrations', workspaceId, false)).status).toBe(404);
  });
});
