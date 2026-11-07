/**
 * The OAuth grant lifecycle: `connected` → `pending_revocation` (disconnect) →
 * `revoked`, and `connected` → `needs_reauth` when a sync's credentials fail.
 * Routes and workers call these transitions; provider I/O stays with them and
 * runs outside any transaction here.
 */
import { insightsRefresh } from '../config/ai-traffic.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { enqueueCoalesced } from '../queue/enqueue.ts';
import { integrationSettings } from './config.ts';
import { recordIntegrationEvents } from './events.ts';

/**
 * Disconnect a connection's grant: request its revocation and retire every
 * property mapping it serves. Connections and their imported evidence stay
 * (raw evidence is append-only), so a reconnect resumes the same history.
 */
export async function disconnectConnection(
  db: Database,
  input: { workspaceId: string; connectionId: string },
): Promise<void> {
  const { workspaceId } = input;
  await db.transaction().execute(async (trx) => {
    const connection = await trx
      .selectFrom('integration_connections')
      .selectAll()
      .where('id', '=', input.connectionId)
      .where('workspace_id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (!connection) throw notFound('Integration connection');
    const grant = await trx
      .selectFrom('integration_oauth_grants')
      .selectAll()
      .where('id', '=', connection.grant_id)
      .where('workspace_id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (!grant) throw notFound('Integration connection');
    const now = new Date();
    if (grant.status !== 'pending_revocation' && grant.status !== 'revoked') {
      await trx
        .updateTable('integration_oauth_grants')
        .set({
          status: 'pending_revocation',
          token_revision: grant.token_revision + 1,
          refresh_claim_id: null,
          refresh_claim_expires_at: null,
          updated_at: now,
        })
        .where('id', '=', grant.id)
        .where('workspace_id', '=', workspaceId)
        .execute();
    }
    const retired = await trx
      .updateTable('integration_property_mappings')
      .set({ status: 'disabled', updated_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('status', '=', 'active')
      .where('connection_id', 'in', (eb) =>
        eb
          .selectFrom('integration_connections')
          .select('id')
          .where('workspace_id', '=', workspaceId)
          .where('grant_id', '=', grant.id),
      )
      .returning('project_id')
      .execute();
    for (const projectId of new Set(retired.map((row) => row.project_id)))
      await enqueueCoalesced(trx, { ...insightsRefresh, workspaceId, projectId }); // NOSONAR -- One transaction runs one statement at a time.
    await recordIntegrationEvents(trx, [
      {
        workspaceId,
        connectionId: connection.id,
        grantId: grant.id,
        type: 'integration.disconnected',
        message: 'Integration disconnected',
        payload: { provider: connection.provider, retired_mappings: retired.length },
        at: now,
      },
    ]);
  });
}

/** Grants awaiting provider revocation whose claim is free or expired. */
export function pendingRevocations(db: Database, limit: number) {
  return db
    .selectFrom('integration_oauth_grants')
    .select(['id', 'workspace_id'])
    .where('status', '=', 'pending_revocation')
    .where((eb) =>
      eb.or([eb('refresh_claim_id', 'is', null), eb('refresh_claim_expires_at', '<=', new Date())]),
    )
    .limit(limit)
    .execute();
}

/**
 * Claim one pending revocation for `claimId`, returning the grant row, or null
 * when it is no longer pending or another claim still holds it.
 */
export function claimRevocation(
  db: Database,
  input: { workspaceId: string; grantId: string; claimId: string },
) {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('integration_oauth_grants')
      .selectAll()
      .where('id', '=', input.grantId)
      .where('workspace_id', '=', input.workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (
      row?.status !== 'pending_revocation' ||
      (row.refresh_claim_expires_at &&
        new Date(row.refresh_claim_expires_at).getTime() > Date.now())
    )
      return null;
    await trx
      .updateTable('integration_oauth_grants')
      .set({
        refresh_claim_id: input.claimId,
        refresh_claim_expires_at: new Date(
          Date.now() + integrationSettings().token_refresh_claim_seconds * 1000,
        ),
      })
      .where('id', '=', input.grantId)
      .where('workspace_id', '=', input.workspaceId)
      .execute();
    return row;
  });
}

/** The provider revoked the grant: clear its credentials under the held claim. */
export function markGrantRevoked(
  db: Database,
  input: { workspaceId: string; grantId: string; claimId: string; tokenRevision: number },
): Promise<void> {
  return db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('integration_oauth_grants')
      .set({
        status: 'revoked',
        access_token_encrypted: '',
        refresh_token_encrypted: '',
        token_expires_at: null,
        refresh_claim_id: null,
        refresh_claim_expires_at: null,
        token_revision: input.tokenRevision + 1,
        updated_at: new Date(),
      })
      .where('id', '=', input.grantId)
      .where('workspace_id', '=', input.workspaceId)
      .where('refresh_claim_id', '=', input.claimId)
      .where('token_revision', '=', input.tokenRevision)
      .where('status', '=', 'pending_revocation')
      .returning('id')
      .executeTakeFirst();
    if (updated)
      await recordIntegrationEvents(trx, [
        {
          workspaceId: input.workspaceId,
          grantId: input.grantId,
          type: 'integration.revoked',
          message: 'Integration grant revoked',
        },
      ]);
  });
}

/** Revocation failed: free the claim so a later pass retries, and record why. */
export function releaseRevocationClaim(
  db: Database,
  input: { workspaceId: string; grantId: string; claimId: string; errorCode: string },
): Promise<void> {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('integration_oauth_grants')
      .set({ refresh_claim_id: null, refresh_claim_expires_at: null, updated_at: new Date() })
      .where('id', '=', input.grantId)
      .where('workspace_id', '=', input.workspaceId)
      .where('refresh_claim_id', '=', input.claimId)
      .execute();
    await recordIntegrationEvents(trx, [
      {
        workspaceId: input.workspaceId,
        grantId: input.grantId,
        type: 'integration.revoke_failed',
        message: 'Integration grant revocation failed',
        payload: { error_code: input.errorCode },
      },
    ]);
  });
}

/**
 * A sync's credentials were refused: the connection's grant needs
 * reauthorization. Only a connected grant moves; a disconnect that committed
 * first keeps its `pending_revocation` so the revoker still revokes it.
 */
export async function markGrantNeedsReauth(
  trx: Database,
  input: { workspaceId: string; connectionId: string; at: Date },
): Promise<boolean> {
  const { grant_id: grantId } = await trx
    .selectFrom('integration_connections')
    .select('grant_id')
    .where('id', '=', input.connectionId)
    .where('workspace_id', '=', input.workspaceId)
    .executeTakeFirstOrThrow();
  const updated = await trx
    .updateTable('integration_oauth_grants')
    .set({ status: 'needs_reauth', updated_at: input.at })
    .where('id', '=', grantId)
    .where('workspace_id', '=', input.workspaceId)
    .where('status', '=', 'connected')
    .executeTakeFirst();
  return updated.numUpdatedRows > 0n;
}
