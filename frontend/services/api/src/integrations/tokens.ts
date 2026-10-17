import { randomUUID } from 'node:crypto';

import type { Database } from '../db/database.ts';
import { IntegrationClient, IntegrationError } from './client.ts';
import type { IntegrationTransport } from './config.ts';

function decryptCredential(client: IntegrationClient, value: string): string {
  try {
    return client.secrets.cipher.decrypt(value);
  } catch {
    throw new IntegrationError('grant_auth_failed', 'Integration credential needs reconnection');
  }
}

/**
 * Refresh a grant outside a transaction and persist only while its fence holds.
 * `rejected` is a token the provider just refused: it is refreshed even before
 * its expiry, unless another caller has already rotated it.
 */
export async function freshAccessToken(
  db: Database,
  grantId: string,
  workspaceId: string,
  client = new IntegrationClient(),
  rejected?: string,
): Promise<string> {
  const settings = client.settings;
  const cutoff = Date.now() + settings.token_refresh_skew_seconds * 1000;
  // Recheck the committed claim fence before each bounded refresh attempt.
  for (
    let wait = 0;
    wait <= settings.token_refresh_wait_seconds * 1000;
    wait += settings.token_refresh_poll_seconds * 1000
  ) {
    const claimId = randomUUID();
    const claimed = await claimRefresh(db, grantId, workspaceId, client, cutoff, claimId, rejected);
    if (claimed?.token) return claimed.token;
    if (claimed === null) {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), settings.token_refresh_poll_seconds * 1000);
      });
      continue;
    }
    const claim = claimed.claim;
    if (claim === null) throw new Error('refresh claim was not returned');
    const token = await rotateToken(db, grantId, workspaceId, client, claim);
    if (token !== null) return token;
    // Losing the fence re-enters the locked status/expiry check on the next iteration.
  }
  throw new IntegrationError('token_refresh_failed', 'Integration token refresh is busy', true);
}

function claimRefresh(
  db: Database,
  grantId: string,
  workspaceId: string,
  client: IntegrationClient,
  cutoff: number,
  claimId: string,
  rejected?: string,
) {
  const settings = client.settings;
  return db.transaction().execute(async (trx) => {
    const grant = await trx
      .selectFrom('integration_oauth_grants')
      .selectAll()
      .where('id', '=', grantId)
      .where('workspace_id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (grant === undefined || grant.status !== 'connected')
      throw new IntegrationError('grant_auth_failed', 'Integration grant is unavailable');
    if (grant.token_expires_at === null || new Date(grant.token_expires_at).getTime() > cutoff) {
      const token = decryptCredential(client, grant.access_token_encrypted);
      if (rejected === undefined || token !== rejected) return { token, claim: null };
    }
    if (
      grant.refresh_claim_expires_at !== null &&
      new Date(grant.refresh_claim_expires_at).getTime() > Date.now()
    )
      return null;
    if (!grant.refresh_token_encrypted)
      throw new IntegrationError('grant_auth_failed', 'Integration grant needs reconnection');
    const leaseUntil = new Date(Date.now() + settings.token_refresh_claim_seconds * 1000);
    await trx
      .updateTable('integration_oauth_grants')
      .set({ refresh_claim_id: claimId, refresh_claim_expires_at: leaseUntil })
      .where('id', '=', grantId)
      .where('workspace_id', '=', workspaceId)
      .execute();
    return {
      token: null,
      claim: {
        id: claimId,
        revision: grant.token_revision,
        transport: grant.transport as IntegrationTransport,
        refresh: decryptCredential(client, grant.refresh_token_encrypted),
      },
    };
  });
}

type RefreshClaim = NonNullable<NonNullable<Awaited<ReturnType<typeof claimRefresh>>>['claim']>;

async function rotateToken(
  db: Database,
  grantId: string,
  workspaceId: string,
  client: IntegrationClient,
  claim: RefreshClaim,
): Promise<string | null> {
  try {
    const tokens = await client.token(claim.transport, {
      grant_type: 'refresh_token',
      refresh_token: claim.refresh,
    });
    const now = new Date();
    const updated = await db
      .updateTable('integration_oauth_grants')
      .set({
        access_token_encrypted: client.secrets.cipher.encrypt(tokens.accessToken),
        refresh_token_encrypted: tokens.refreshToken
          ? client.secrets.cipher.encrypt(tokens.refreshToken)
          : '',
        token_expires_at:
          tokens.expiresIn === null ? null : new Date(now.getTime() + tokens.expiresIn * 1000),
        ...(tokens.scopes.length ? { granted_scopes: JSON.stringify(tokens.scopes) } : {}),
        status: 'connected',
        token_revision: claim.revision + 1,
        refresh_claim_id: null,
        refresh_claim_expires_at: null,
        updated_at: now,
      })
      .where('id', '=', grantId)
      .where('workspace_id', '=', workspaceId)
      .where('refresh_claim_id', '=', claim.id)
      .where('token_revision', '=', claim.revision)
      .where('status', '=', 'connected')
      .where('refresh_claim_expires_at', '>', now)
      .returning('id')
      .executeTakeFirst();
    if (updated) return tokens.accessToken;
    return null;
  } catch (error) {
    await db
      .updateTable('integration_oauth_grants')
      .set({ refresh_claim_id: null, refresh_claim_expires_at: null })
      .where('id', '=', grantId)
      .where('workspace_id', '=', workspaceId)
      .where('refresh_claim_id', '=', claim.id)
      .execute();
    throw error;
  }
}
