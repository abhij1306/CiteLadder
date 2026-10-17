/**
 * MCP authentication: the static `MCP_TOKEN` bearer. The token is backed by
 * one stored grant for the local user, so live-grant checks (writes,
 * confirmations, budgets) keep a grant to read.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { localAccount } from '../auth/local.ts';
import type { ServiceConfig } from '../config.ts';
import type { Database } from '../db/database.ts';
import { loadMcpConfig, mcpPolicy } from './config.ts';
import type { McpPrincipal } from './types.ts';

export const tokenHash = (_config: ServiceConfig, value: string) =>
  createHash('sha256').update(value).digest('hex');
function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOCAL_CLIENT_ID = 'local-static-token';
// The grant never expires on its own; changing MCP_TOKEN replaces it.
const NEVER = new Date('9999-12-31T00:00:00Z');

/** The grant row backing the current token, created or rotated on demand. */
async function ensureLocalGrant(db: Database, digest: string) {
  const { userId, workspaceId } = await localAccount(db);
  return db.transaction().execute(async (trx) => {
    const now = new Date();
    // A previous token's grant ends when the token changes.
    await trx
      .updateTable('mcp_oauth_grants')
      .set({ revoked_at: now, updated_at: now })
      .where('client_id', '=', LOCAL_CLIENT_ID)
      .where('access_token_hash', '!=', digest)
      .where('revoked_at', 'is', null)
      .execute();
    const existing = await trx
      .selectFrom('mcp_oauth_grants')
      .select(['id', 'revoked_at'])
      .where('access_token_hash', '=', digest)
      .executeTakeFirst();
    if (existing) {
      // A token switched back to is live again.
      if (existing.revoked_at)
        await trx
          .updateTable('mcp_oauth_grants')
          .set({ revoked_at: null, updated_at: now })
          .where('id', '=', existing.id)
          .execute();
      return existing.id;
    }
    await trx
      .insertInto('mcp_oauth_clients')
      .values({
        id: randomUUID(),
        client_id: LOCAL_CLIENT_ID,
        client_metadata: JSON.stringify({ client_name: 'Local MCP token' }),
        client_secret_encrypted: '',
        created_at: now,
      })
      .onConflict((conflict) => conflict.column('client_id').doNothing())
      .execute();
    const grant = await trx
      .insertInto('mcp_oauth_grants')
      .values({
        id: randomUUID(),
        client_id: LOCAL_CLIENT_ID,
        user_id: userId,
        workspace_ids: JSON.stringify([workspaceId]),
        scopes: JSON.stringify(mcpPolicy.scopes_supported),
        resource: '/mcp',
        access_token_hash: digest,
        refresh_token_hash: digest,
        access_expires_at: NEVER,
        refresh_expires_at: NEVER,
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return grant.id;
  });
}

const grants = new Map<string, Promise<string>>();

export async function authenticateMcp(
  db: Database,
  config: ServiceConfig,
  request: Request,
  mcp = loadMcpConfig(config),
): Promise<McpPrincipal | null> {
  const bearer = /^Bearer +(\S+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!mcp.enabled || !bearer || !equalSecret(bearer, mcp.token)) return null;
  const digest = tokenHash(config, bearer);
  let grant = grants.get(digest);
  if (!grant) {
    grant = ensureLocalGrant(db, digest);
    grants.clear();
    grants.set(digest, grant);
    grant.catch(() => grants.delete(digest));
  }
  const [grantId, { userId, workspaceId }] = await Promise.all([grant, localAccount(db)]);
  return { userId, grantId, workspaceIds: [workspaceId], tokenHash: digest, canWrite: true };
}
