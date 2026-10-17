import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { IntegrationClient, IntegrationError } from '../src/integrations/client.ts';
import { IntegrationDispatcher } from '../src/workers/integration-dispatcher.ts';
import { Fixtures, testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
const secrets = new IntegrationClient({}).secrets;
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('integration revocation', () => {
  it('finishes admitted revocation and leaves the next grant pending when the budget expires', async () => {
    const user = await fixtures.user();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) {
      const workspaceId = await fixtures.joinedWorkspace(user);
      await db
        .insertInto('integration_oauth_grants')
        .values({
          id,
          workspace_id: workspaceId,
          transport: 'google_oauth',
          status: 'pending_revocation',
          access_token_encrypted: secrets.cipher.encrypt('test-access'),
          refresh_token_encrypted: '',
          token_expires_at: null,
          token_revision: 1,
          refresh_claim_id: null,
          refresh_claim_expires_at: null,
          granted_scopes: '[]',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
    }
    let active = true;
    const revoke = vi.fn(async () => {
      active = false;
    });
    await new IntegrationDispatcher(db, { secrets, revoke }).runOnce(() => active);
    expect(revoke).toHaveBeenCalledTimes(1);
    const rows = await db
      .selectFrom('integration_oauth_grants')
      .select(['status', 'refresh_claim_id'])
      .where('id', 'in', ids)
      .execute();
    expect(rows.map((row) => row.status).sort()).toEqual(['pending_revocation', 'revoked']);
    expect(rows.every((row) => row.refresh_claim_id === null)).toBe(true);
    await db.deleteFrom('integration_events').where('grant_id', 'in', ids).execute();
    await db.deleteFrom('integration_oauth_grants').where('id', 'in', ids).execute();
  });
  it.each([false, true])(
    'resolves unreadable credentials locally but preserves provider failures (%s)',
    async (decryptable) => {
      const workspaceId = await fixtures.ownedWorkspace(await fixtures.user());
      const id = randomUUID();
      await db
        .insertInto('integration_oauth_grants')
        .values({
          id,
          workspace_id: workspaceId,
          transport: 'google_oauth',
          status: 'pending_revocation',
          access_token_encrypted: decryptable
            ? secrets.cipher.encrypt('test-access')
            : 'unreadable',
          refresh_token_encrypted: decryptable
            ? secrets.cipher.encrypt('test-refresh')
            : 'unreadable',
          token_expires_at: null,
          token_revision: 1,
          refresh_claim_id: null,
          refresh_claim_expires_at: null,
          granted_scopes: JSON.stringify([]),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();
      const revoke = vi.fn(async () => {
        throw new IntegrationError('provider_api_error', 'recorded revocation failure', true);
      });
      await new IntegrationDispatcher(db, { secrets, revoke }).runOnce();
      const grant = await db
        .selectFrom('integration_oauth_grants')
        .select([
          'status',
          'access_token_encrypted',
          'refresh_token_encrypted',
          'refresh_claim_id',
          'token_revision',
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      if (decryptable) {
        expect(revoke).toHaveBeenCalledTimes(1);
        expect(grant.status).toBe('pending_revocation');
        expect(grant.token_revision).toBe(1);
        expect(secrets.cipher.decrypt(grant.refresh_token_encrypted)).toBe('test-refresh');
      } else {
        expect(revoke).not.toHaveBeenCalled();
        expect(grant).toEqual({
          status: 'revoked',
          access_token_encrypted: '',
          refresh_token_encrypted: '',
          refresh_claim_id: null,
          token_revision: 2,
        });
      }
      const events = await db
        .selectFrom('integration_events')
        .select('event_type')
        .where('grant_id', '=', id)
        .execute();
      expect(events.map((event) => event.event_type)).toEqual([
        decryptable ? 'integration.revoke_failed' : 'integration.revoked',
      ]);
    },
  );
});
