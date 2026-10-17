import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { policy } from '../src/config.ts';
import { IntegrationClient } from '../src/integrations/client.ts';
import { completeOAuth, startOAuth, stateReturnPath } from '../src/integrations/oauth.ts';
import { seedProject } from './referral-fixtures.ts';
import { Fixtures, testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

function configureOAuth() {
  vi.stubEnv(policy.settings.integration_google_client_id.env[0]!, 'test-client');
  vi.stubEnv(policy.settings.integration_google_client_secret.env[0]!, 'test-secret');
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'recorded-access',
          refresh_token: 'recorded-refresh',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('integration OAuth state and persistence', () => {
  it.each(['member', 'viewer', 'removed'])(
    'rejects %s authority before code exchange',
    async (role) => {
      const fetch = configureOAuth();
      const userId = await fixtures.user();
      const workspaceId = await fixtures.ownedWorkspace(userId);
      const start = await startOAuth(db, { userId, workspaceId, provider: 'gsc' });
      if (role === 'removed')
        await db.deleteFrom('workspace_members').where('workspace_id', '=', workspaceId).execute();
      else
        await db
          .updateTable('workspace_members')
          .set({ role })
          .where('workspace_id', '=', workspaceId)
          .execute();
      await expect(
        completeOAuth(db, {
          provider: 'gsc',
          code: 'recorded-code',
          nonce: start.nonce,
          state: new URL(start.url).searchParams.get('state')!,
        }),
      ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['member', 'removed'])(
    'writes nothing when %s authority changes during exchange',
    async (role) => {
      configureOAuth();
      const userId = await fixtures.user();
      const workspaceId = await fixtures.ownedWorkspace(userId);
      const start = await startOAuth(db, { userId, workspaceId, provider: 'gsc' });
      const exchange = vi
        .spyOn(IntegrationClient.prototype, 'token')
        .mockImplementationOnce(async () => {
          await db.transaction().execute(async (trx) => {
            await trx
              .selectFrom('workspaces')
              .select('id')
              .where('id', '=', workspaceId)
              .forUpdate()
              .executeTakeFirstOrThrow();
            if (role === 'removed')
              await trx
                .deleteFrom('workspace_members')
                .where('workspace_id', '=', workspaceId)
                .execute();
            else
              await trx
                .updateTable('workspace_members')
                .set({ role })
                .where('workspace_id', '=', workspaceId)
                .execute();
          });
          return { accessToken: 'recorded', refreshToken: 'recorded', expiresIn: 3600, scopes: [] };
        });
      try {
        await expect(
          completeOAuth(db, {
            provider: 'gsc',
            code: 'recorded-code',
            nonce: start.nonce,
            state: new URL(start.url).searchParams.get('state')!,
          }),
        ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        for (const table of [
          'integration_oauth_grants',
          'integration_connections',
          'integration_events',
        ] as const) {
          expect(
            await db
              .selectFrom(table)
              .select('id')
              .where('workspace_id', '=', workspaceId)
              .execute(),
          ).toEqual([]);
        }
      } finally {
        exchange.mockRestore();
      }
    },
  );

  it('allows an admin to complete credential consent', async () => {
    configureOAuth();
    const ownerId = await fixtures.user();
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(ownerId);
    await fixtures.member(workspaceId, userId, 'admin');
    const start = await startOAuth(db, { userId, workspaceId, provider: 'gsc' });
    await completeOAuth(db, {
      provider: 'gsc',
      code: 'recorded-code',
      nonce: start.nonce,
      state: new URL(start.url).searchParams.get('state')!,
    });
    expect(
      await db
        .selectFrom('integration_oauth_grants')
        .select('status')
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirst(),
    ).toMatchObject({ status: 'connected' });
  });
  it('binds callback state to the browser, persists one Google grant, and rejects replay', async () => {
    const fetch = configureOAuth();
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(userId);
    const start = await startOAuth(db, { userId, workspaceId, provider: 'gsc' });
    const state = new URL(start.url).searchParams.get('state')!;
    const callback = { provider: 'gsc', code: 'recorded-code', state, nonce: start.nonce };
    await expect(completeOAuth(db, { ...callback, nonce: 'wrong-browser' })).rejects.toMatchObject({
      code: 'oauth_state_invalid',
    });
    expect(fetch).not.toHaveBeenCalled();
    await completeOAuth(db, callback);
    await expect(completeOAuth(db, callback)).rejects.toMatchObject({
      code: 'oauth_state_invalid',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const grant = await db
      .selectFrom('integration_oauth_grants')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirstOrThrow();
    expect(new IntegrationClient({}).secrets.cipher.decrypt(grant.refresh_token_encrypted)).toBe(
      'recorded-refresh',
    );
    const connections = await db
      .selectFrom('integration_connections')
      .select('provider')
      .where('workspace_id', '=', workspaceId)
      .where('grant_id', '=', grant.id)
      .execute();
    expect(connections.map((row) => row.provider).sort()).toEqual(['ga4', 'gsc']);
  });

  it('checks current workspace membership before exchanging a consumed callback state', async () => {
    const fetch = configureOAuth();
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(userId);
    const start = await startOAuth(db, { userId, workspaceId, provider: 'gsc' });
    await db
      .deleteFrom('workspace_members')
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', userId)
      .execute();
    await expect(
      completeOAuth(db, {
        provider: 'gsc',
        code: 'recorded-code',
        nonce: start.nonce,
        state: new URL(start.url).searchParams.get('state')!,
      }),
    ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('carries only an allowed app path through the signed state', async () => {
    configureOAuth();
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(userId);
    const stateFor = async (returnTo: string) =>
      new URL(
        (await startOAuth(db, { userId, workspaceId, provider: 'gsc', returnTo })).url,
      ).searchParams.get('state')!;
    expect(await stateReturnPath(await stateFor('/demand?connected=gsc&tab=all'))).toBe(
      '/demand?tab=all',
    );
    for (const hostile of ['//evil.test', 'https://evil.test/demand', '/admin', 'demand'])
      expect(await stateReturnPath(await stateFor(hostile))).toBeNull();
    expect(await stateReturnPath('forged.state.value')).toBeNull();
  });

  it('queues a catch-up sync for mapped properties when a grant is reconnected', async () => {
    configureOAuth();
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(userId);
    const projectId = await seedProject(db, workspaceId);
    const consent = async () => {
      const start = await startOAuth(db, { userId, workspaceId, provider: 'gsc' });
      await completeOAuth(db, {
        provider: 'gsc',
        code: 'recorded-code',
        nonce: start.nonce,
        state: new URL(start.url).searchParams.get('state')!,
      });
    };
    await consent();
    const gsc = await db
      .selectFrom('integration_connections')
      .select(['id', 'grant_id'])
      .where('workspace_id', '=', workspaceId)
      .where('provider', '=', 'gsc')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('integration_property_mappings')
      .values({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        connection_id: gsc.id,
        provider: 'gsc',
        property_ref: 'https://example.test',
        project_id: projectId,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    await db
      .updateTable('integration_oauth_grants')
      .set({ status: 'needs_reauth' })
      .where('id', '=', gsc.grant_id)
      .execute();
    await consent();
    const runs = await db
      .selectFrom('integration_sync_runs')
      .select(['sync_kind', 'status'])
      .where('connection_id', '=', gsc.id)
      .execute();
    expect(runs).toEqual([{ sync_kind: 'scheduled', status: 'queued' }]);
  });
});
