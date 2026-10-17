import { randomBytes, randomUUID } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';
import type { Database } from '../db/database.ts';
import { IntegrationClient, IntegrationError } from './client.ts';
import { policy } from '../config.ts';
import { resolveWorkspaceMember } from '../auth/workspace.ts';
import { lockAuthorizedWorkspace } from '../workspaces/service.ts';
import { ApiError } from '../errors.ts';
import { enqueueSyncRun } from './sync.ts';
import { getLogger } from '../logging.ts';
import {
  endpoints,
  integrationPolicy,
  integrationSecrets,
  type IntegrationTransport,
} from './config.ts';

const secrets = integrationSecrets();
const logger = getLogger('api.integrations.oauth');
const key = new TextEncoder().encode(secrets.stateSigningKey);

export function providerKnown(provider: string): provider is 'gsc' | 'ga4' | 'bing' {
  return new Set<string>(integrationPolicy.transport.INTEGRATION_PROVIDERS).has(provider);
}

export function oauthCookieOptions(maxAge: number) {
  const isInsecure = policy.development_env_names.includes(
    (process.env.APP_ENV ?? '').toLowerCase(),
  );
  return `Path=${endpoints.INTEGRATION_OAUTH_TRANSACTION_COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isInsecure ? '' : '; Secure'}`;
}

const RETURN_PATH_MAX = 512;

/**
 * A same-origin app path the callback may land on, or null. Only the listed
 * screens qualify, so an OAuth round trip can never redirect off-site; any
 * earlier callback result in the query is dropped.
 */
export function oauthReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > RETURN_PATH_MAX || !value.startsWith('/') || value.startsWith('//'))
    return null;
  let url: URL;
  try {
    url = new URL(value, 'https://app.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://app.invalid') return null;
  const allowed = endpoints.INTEGRATION_OAUTH_RETURN_PATHS.some(
    (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
  );
  if (!allowed) return null;
  url.searchParams.delete('connected');
  url.searchParams.delete('error');
  return `${url.pathname}${url.search}`;
}

/** The return path carried by a signed state, or null when absent or unverifiable. */
export async function stateReturnPath(state: string | null | undefined): Promise<string | null> {
  if (!state) return null;
  const verified = await jwtVerify(state, key, { algorithms: ['HS256'] }).catch(() => null);
  const claim = verified?.payload.return_to;
  return typeof claim === 'string' ? oauthReturnPath(claim) : null;
}

export async function startOAuth(
  db: Database,
  input: { workspaceId: string; userId: string; provider: string; returnTo?: string | null },
) {
  if (!providerKnown(input.provider))
    throw new IntegrationError('provider_api_error', 'Unknown integration provider');
  const transport = endpoints.INTEGRATION_PROVIDER_TRANSPORT[
    input.provider
  ] as IntegrationTransport;
  const client = new IntegrationClient();
  const credential = client.secrets.credentials[transport];
  if (!credential.id || !credential.secret)
    throw new IntegrationError(
      'oauth_not_configured',
      'The integration provider is not configured',
    );

  const returnTo = oauthReturnPath(input.returnTo);
  const nonce = randomBytes(32).toString('base64url');
  const jti = randomBytes(24).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const state = await new SignJWT({
    provider: input.provider,
    nonce: randomBytes(16).toString('base64url'),
    session_nonce: nonce,
    workspace_id: input.workspaceId,
    user_id: input.userId,
    ...(returnTo ? { return_to: returnTo } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('oauth-state')
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + secrets.stateTtl)
    .sign(key);
  const expiresAt = new Date((now + secrets.stateTtl) * 1000);
  await db
    .insertInto('integration_oauth_states')
    .values({
      id: randomUUID(),
      jti,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      provider: input.provider,
      expires_at: expiresAt,
      consumed_at: null,
      created_at: new Date(),
    })
    .execute();

  const authorize = new URL(endpoints.INTEGRATION_OAUTH_AUTHORIZE_URLS[transport]);
  authorize.searchParams.set('client_id', credential.id);
  authorize.searchParams.set(
    'redirect_uri',
    `${client.secrets.frontendUrl}${endpoints.INTEGRATION_OAUTH_CALLBACK_PATH.replace('{provider}', input.provider)}`,
  );
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', endpoints.INTEGRATION_OAUTH_SCOPES[transport].join(' '));
  authorize.searchParams.set('state', state);
  if (transport === 'google_oauth') {
    authorize.searchParams.set('access_type', 'offline');
    authorize.searchParams.set('prompt', 'consent');
    const identity = await db
      .selectFrom('user_identities')
      .select('email')
      .where('user_id', '=', input.userId)
      .where('provider', '=', 'google')
      .executeTakeFirst();
    if (identity?.email) {
      authorize.searchParams.set('login_hint', identity.email);
      authorize.searchParams.set('include_granted_scopes', 'true');
    }
  }
  return { url: authorize.toString(), nonce, maxAge: secrets.stateTtl };
}

export async function completeOAuth(
  db: Database,
  input: {
    provider: string;
    code: string;
    state: string;
    nonce: string;
  },
) {
  if (!providerKnown(input.provider) || !input.nonce)
    throw new IntegrationError('oauth_state_invalid', 'Invalid OAuth state');
  const verified = await jwtVerify(input.state, key, { algorithms: ['HS256'] }).catch(() => null);
  const claims = verified?.payload;
  if (
    claims?.sub !== 'oauth-state' ||
    claims.provider !== input.provider ||
    claims.session_nonce !== input.nonce ||
    typeof claims.jti !== 'string' ||
    typeof claims.workspace_id !== 'string' ||
    typeof claims.user_id !== 'string'
  ) {
    throw new IntegrationError('oauth_state_invalid', 'Invalid OAuth state');
  }
  const workspaceId = claims.workspace_id;
  const userId = claims.user_id;
  const now = new Date();
  const consumed = await db
    .updateTable('integration_oauth_states')
    .set({ consumed_at: now })
    .where('jti', '=', claims.jti)
    .where('provider', '=', input.provider)
    .where('workspace_id', '=', workspaceId)
    .where('user_id', '=', userId)
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', now)
    .returning('id')
    .executeTakeFirst();
  if (!consumed) throw new IntegrationError('oauth_state_invalid', 'Invalid OAuth state');
  await requireCredentialAuthority(db, workspaceId, userId);

  const transport = endpoints.INTEGRATION_PROVIDER_TRANSPORT[
    input.provider
  ] as IntegrationTransport;
  const client = new IntegrationClient();
  const redirectUri = `${client.secrets.frontendUrl}${endpoints.INTEGRATION_OAUTH_CALLBACK_PATH.replace('{provider}', input.provider)}`;
  const bundle = await client.token(transport, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUri,
  });
  const connectedGrant = await db.transaction().execute(async (trx) => {
    await requireCredentialAuthority(trx, workspaceId, userId, true);
    const existing = await trx
      .selectFrom('integration_oauth_grants')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('transport', '=', transport)
      .forUpdate()
      .executeTakeFirst();
    const grantId = existing?.id ?? randomUUID();
    const createdAt = existing?.created_at ?? new Date();
    const scopes = bundle.scopes;
    if (existing) {
      await trx
        .updateTable('integration_oauth_grants')
        .set({
          access_token_encrypted: client.secrets.cipher.encrypt(bundle.accessToken),
          refresh_token_encrypted: bundle.refreshToken
            ? client.secrets.cipher.encrypt(bundle.refreshToken)
            : existing.refresh_token_encrypted,
          token_expires_at:
            bundle.expiresIn === null ? null : new Date(Date.now() + bundle.expiresIn * 1000),
          granted_scopes: JSON.stringify(scopes),
          status: 'connected',
          token_revision: existing.token_revision + 1,
          refresh_claim_id: null,
          refresh_claim_expires_at: null,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .where('workspace_id', '=', workspaceId)
        .execute();
    } else {
      await trx
        .insertInto('integration_oauth_grants')
        .values({
          id: grantId,
          workspace_id: workspaceId,
          transport,
          access_token_encrypted: client.secrets.cipher.encrypt(bundle.accessToken),
          refresh_token_encrypted: bundle.refreshToken
            ? client.secrets.cipher.encrypt(bundle.refreshToken)
            : '',
          token_expires_at:
            bundle.expiresIn === null ? null : new Date(Date.now() + bundle.expiresIn * 1000),
          token_revision: 1,
          refresh_claim_id: null,
          refresh_claim_expires_at: null,
          granted_scopes: JSON.stringify(scopes),
          status: 'connected',
          created_at: createdAt,
          updated_at: new Date(),
        })
        .execute();
    }
    const providers = Object.entries(endpoints.INTEGRATION_PROVIDER_TRANSPORT)
      .filter(([, value]) => value === transport)
      .map(([provider]) => provider);
    for (const provider of providers) {
      await trx
        .insertInto('integration_connections')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          grant_id: grantId,
          provider,
          label: '',
          account_ref: '',
          dataset_capabilities: JSON.stringify({}),
          last_synced_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((conflict) => conflict.columns(['grant_id', 'provider']).doNothing())
        .execute();
    }
    await trx
      .insertInto('integration_events')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        connection_id: null,
        grant_id: grantId,
        event_type: 'integration.connected',
        message: `Integration connected via ${transport}`,
        payload: JSON.stringify({ provider: input.provider, transport, providers }),
        created_at: new Date(),
      })
      .execute();
    return grantId;
  });
  await queueCatchUp(db, workspaceId, connectedGrant);
}

/**
 * A reconnect resumes the grant's mapped properties at once rather than at the
 * next scheduled run; each sync re-reads only the days after its coverage.
 * Best effort: the scheduled dispatcher covers anything this cannot queue.
 */
async function queueCatchUp(db: Database, workspaceId: string, grantId: string) {
  const mappings = await db
    .selectFrom('integration_property_mappings as mapping')
    .innerJoin('integration_connections as connection', (join) =>
      join
        .onRef('connection.id', '=', 'mapping.connection_id')
        .onRef('connection.workspace_id', '=', 'mapping.workspace_id'),
    )
    .select(['mapping.id', 'mapping.connection_id', 'mapping.project_id'])
    .where('mapping.workspace_id', '=', workspaceId)
    .where('connection.grant_id', '=', grantId)
    .where('mapping.status', '=', 'active')
    .execute();
  for (const mapping of mappings) {
    const target = {
      workspaceId,
      connectionId: mapping.connection_id,
      mappingId: mapping.id,
      projectId: mapping.project_id,
      syncKind: 'scheduled' as const,
    };
    try {
      await enqueueSyncRun(db, target); // NOSONAR -- Each enqueue takes the workspace lock.
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // Best effort: the scheduled dispatcher still covers this mapping.
      logger.info('integration_catch_up_skipped', {
        mapping_id: mapping.id,
        error_code: error.code,
      });
    }
  }
}

/** Any authority failure reads as an invalid state; `lock` holds the workspace for the write. */
async function requireCredentialAuthority(
  db: Database,
  workspaceId: string,
  userId: string,
  lock = false,
) {
  try {
    if (lock) await lockAuthorizedWorkspace(db, workspaceId, userId, 'manage_credentials');
    else (await resolveWorkspaceMember(db, userId, workspaceId)).require('manage_credentials');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    throw new IntegrationError('oauth_state_invalid', 'Invalid OAuth state');
  }
  const user = await db
    .selectFrom('users')
    .select('is_active')
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user?.is_active) throw new IntegrationError('oauth_state_invalid', 'Invalid OAuth state');
}
