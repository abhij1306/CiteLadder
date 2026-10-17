import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { ProviderConnections } from '../generated/db-schema.ts';
import { ApiError, notFound } from '../errors.ts';
import { createSecretCipher } from '../integrations/fernet.ts';
import { recordSecurityEvent } from '../auth/security-events.ts';
import { stripTrailing } from '../text-order.ts';
import { providerPolicy, type Engine, type ProviderSettings } from './config.ts';
import type { ConnectionCreate, ConnectionUpdate } from './inputs.ts';

export type Connection = Selectable<ProviderConnections>;
const invalid = (message: string) => new ApiError(400, message);
export function tenantConnections(db: Database, workspaceId: string) {
  return db
    .selectFrom('provider_connections as c')
    .innerJoin('workspaces as w', 'w.id', 'c.workspace_id')
    .selectAll('c')
    .where('c.workspace_id', '=', workspaceId)
    .where('w.is_system', '=', false)
    .where('c.credential_source', '=', 'byok');
}
export async function getConnection(db: Database, workspaceId: string, id: string, lock = false) {
  let query = tenantConnections(db, workspaceId).where('c.id', '=', id);
  if (lock) query = query.forUpdate('c');
  const row = await query.executeTakeFirst();
  if (!row) throw notFound('Provider connection');
  return row;
}
export function requireActiveTransport(row: Connection) {
  if (!providerPolicy.transports.includes(row.transport_provider))
    throw new ApiError(
      409,
      'This connection uses a retired transport and is historical and read-only',
    );
}
/** The `Authorization` header value for a provider's login/password pair. */
export function basicAuthorization(pair: { login: string; password: string }) {
  const credentials = Buffer.from(`${pair.login}:${pair.password}`).toString('base64');
  return `Basic ${credentials}`;
}
export function approvedEndpoint(transport: string, baseUrl: string, settings: ProviderSettings) {
  const endpoint = settings.endpoints[transport as keyof typeof settings.endpoints];
  if (
    !endpoint ||
    (baseUrl && stripTrailing(baseUrl.trim(), '/') !== stripTrailing(endpoint.trim(), '/'))
  )
    throw invalid('Provider endpoint is not approved for this transport');
  return stripTrailing((baseUrl || endpoint).trim(), '/');
}
function rotatedSecret(
  transport: string,
  input: Pick<ConnectionUpdate, 'api_key' | 'api_login' | 'api_password'>,
) {
  const key = input.api_key?.trim() || '';
  const login = input.api_login?.trim() || '';
  const password = input.api_password || '';
  if (transport === 'dataforseo') {
    if (key) throw invalid('This connection uses an API login and password');
    if (!login && !password) return null;
    if (!login || !password) throw invalid('Both credential halves are required');
    return JSON.stringify({ login, password });
  }
  if (login || password) throw invalid('This connection uses a single API key');
  return key || null;
}
export async function connectionResponse(db: Database, row: Connection) {
  const routes = await db
    .selectFrom('provider_routes')
    .select([
      'id',
      'logical_engine',
      'transport_provider',
      'transport_model',
      'is_default',
      'active',
    ])
    .where('workspace_id', '=', row.workspace_id)
    .where('connection_id', '=', row.id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    label: row.label,
    transport_provider: row.transport_provider as 'openai' | 'anthropic' | 'google' | 'dataforseo',
    base_url: row.base_url,
    active: row.active,
    api_key_set: Boolean(row.api_key_encrypted),
    last_tested_at: row.last_tested_at?.toISOString() ?? null,
    last_test_status: row.last_test_status,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    routes: routes.map((route) => ({
      ...route,
      logical_engine: route.logical_engine as Engine,
      transport_provider: route.transport_provider as
        | 'openai'
        | 'anthropic'
        | 'google'
        | 'dataforseo',
    })),
  };
}
type RouteInput = ConnectionCreate['routes'][number];
async function replaceRoutes(
  db: Database,
  row: Connection,
  requested: RouteInput[],
  append = false,
) {
  const prior = await db
    .selectFrom('provider_routes')
    .selectAll()
    .where('workspace_id', '=', row.workspace_id)
    .where('connection_id', '=', row.id)
    .execute();
  const inputs = [...requested];
  if (row.transport_provider === 'dataforseo')
    for (const [engine, route] of Object.entries(providerPolicy.routes))
      if (
        route.transport_provider === 'dataforseo' &&
        !inputs.some((item) => item.logical_engine === engine)
      )
        inputs.push({ logical_engine: engine as Engine, is_default: false });
  if (!append)
    await db
      .deleteFrom('provider_routes')
      .where('workspace_id', '=', row.workspace_id)
      .where('connection_id', '=', row.id)
      .execute();
  for (const input of inputs) {
    const route = providerPolicy.routes[input.logical_engine];
    if (!route || route.transport_provider !== row.transport_provider)
      throw invalid('Provider route is not approved');
    const old = prior.find((item) => item.logical_engine === input.logical_engine);
    if (append && old) continue;
    const now = new Date();
    await db
      .insertInto('provider_routes')
      .values({
        id: randomUUID(),
        connection_id: row.id,
        workspace_id: row.workspace_id,
        logical_engine: input.logical_engine,
        transport_provider: route.transport_provider,
        transport_model: route.transport_model,
        is_default: input.is_default,
        active: old?.active ?? true,
        deactivation_reason: old?.deactivation_reason ?? '',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
}
async function lockWorkspace(db: Database, id: string) {
  const row = await db
    .selectFrom('workspaces')
    .select('id')
    .where('id', '=', id)
    .where('is_system', '=', false)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound('Workspace');
}
export async function createConnection(
  db: Database,
  workspaceId: string,
  actorId: string,
  input: ConnectionCreate,
  encryptionKey: string,
  settings: ProviderSettings,
) {
  const id = await db.transaction().execute(async (trx) => {
    await lockWorkspace(trx, workspaceId);
    approvedEndpoint(input.transport_provider, input.base_url, settings);
    const secret = rotatedSecret(input.transport_provider, input);
    if (!secret) throw invalid('Credentials are required');
    const now = new Date();
    const row = await trx
      .insertInto('provider_connections')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        label: input.label,
        transport_provider: input.transport_provider,
        base_url: input.base_url,
        active: input.active,
        api_key_encrypted: createSecretCipher(encryptionKey).encrypt(secret),
        credential_revision: randomUUID(),
        credential_source: 'byok',
        last_test_status: '',
        last_tested_at: null,
        paused_at: null,
        pause_until: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await replaceRoutes(trx, row, input.routes);
    await recordSecurityEvent(trx, 'credential.create', actorId, workspaceId, row.id);
    return row.id;
  });
  return connectionResponse(db, await getConnection(db, workspaceId, id));
}
export async function updateConnection(
  db: Database,
  workspaceId: string,
  actorId: string,
  id: string,
  input: ConnectionUpdate,
  encryptionKey: string,
  settings: ProviderSettings,
) {
  await db.transaction().execute(async (trx) => {
    await lockWorkspace(trx, workspaceId);
    const row = await getConnection(trx, workspaceId, id, true);
    requireActiveTransport(row);
    const secret = rotatedSecret(row.transport_provider, input);
    if (input.base_url != null) {
      const destination = approvedEndpoint(row.transport_provider, input.base_url, settings);
      const previous = approvedEndpoint(row.transport_provider, row.base_url, settings);
      if (destination !== previous && (!secret || !input.confirm_destination_change))
        throw invalid('Changing a provider endpoint requires a fresh API key and confirmation');
    }
    const changed = Object.entries(input).some(
      ([key, value]) => key !== 'confirm_destination_change' && value != null,
    );
    if (changed) {
      await trx
        .updateTable('provider_connections')
        .set({
          label: input.label ?? row.label,
          active: input.active ?? row.active,
          base_url: input.base_url ?? row.base_url,
          updated_at: new Date(),
          ...(secret
            ? {
                api_key_encrypted: createSecretCipher(encryptionKey).encrypt(secret),
                credential_revision: randomUUID(),
                last_tested_at: null,
                last_test_status: '',
              }
            : {}),
        })
        .where('id', '=', id)
        .where('workspace_id', '=', workspaceId)
        .execute();
      if (input.routes != null) await replaceRoutes(trx, row, input.routes);
      await recordSecurityEvent(trx, 'credential.update', actorId, workspaceId, id);
    }
  });
  return connectionResponse(db, await getConnection(db, workspaceId, id));
}
export async function deleteConnection(
  db: Database,
  workspaceId: string,
  actorId: string,
  id: string,
) {
  try {
    await db.transaction().execute(async (trx) => {
      await lockWorkspace(trx, workspaceId);
      await getConnection(trx, workspaceId, id, true);
      await trx.deleteFrom('provider_capacity_buckets').where('connection_id', '=', id).execute();
      await trx
        .deleteFrom('provider_connections')
        .where('id', '=', id)
        .where('workspace_id', '=', workspaceId)
        .execute();
      await recordSecurityEvent(trx, 'credential.delete', actorId, workspaceId, id);
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23503')
      throw new ApiError(409, 'Connection is referenced by immutable execution evidence');
    throw error;
  }
}
export async function provisionRoutes(db: Database, workspaceId: string, id: string) {
  await db.transaction().execute(async (trx) => {
    const row = await getConnection(trx, workspaceId, id, true);
    if (row.transport_provider !== 'dataforseo') throw invalid('Connection is not DataForSEO');
    await replaceRoutes(trx, row, [], true);
  });
  return connectionResponse(db, await getConnection(db, workspaceId, id));
}
