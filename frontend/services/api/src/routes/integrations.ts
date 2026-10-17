import {
  integrationBackfillProgressSchema,
  integrationConnectionListSchema,
  performanceSyncEnqueueResponseSchema,
  integrationPropertyListSchema,
  integrationPropertyMappingListSchema,
  integrationSyncEnqueueSchema,
  integrationSyncRunSchema,
  integrationTestResultSchema,
} from '@citeladder/contracts/integrations';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import { z } from 'zod';
import { enqueueTrafficInsights } from '../crawl-logs/insights-enqueue.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { readBody, readOptionalBody } from '../http/body.ts';
import { executeInteractiveSyncs } from '../integrations/interactive.ts';
import { IntegrationClient, IntegrationError } from '../integrations/client.ts';
import { integrationPolicy } from '../integrations/config.ts';
import {
  completeOAuth,
  oauthCookieOptions,
  oauthReturnPath,
  providerKnown,
  startOAuth,
  stateReturnPath,
} from '../integrations/oauth.ts';
import {
  projectSiteDomains,
  propertyMatchesSite,
  siteDomainsOf,
} from '../integrations/host-scope.ts';
import {
  activePropertySync,
  enqueueHistoryBackfill,
  enqueueSyncRun,
  getBackfillProgress,
  listMappings,
  getSyncRun,
} from '../integrations/sync.ts';
import { freshAccessToken } from '../integrations/tokens.ts';
import { getLogger } from '../logging.ts';
import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { policy, resolveSettingSpec } from '../config.ts';
import { defineDeleteRoute, defineGetRoute, definePostRoute } from './define.ts';

const family = 'integrations';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const connectionPath = { connection_id: uuid } as const;
const syncPath = { ...connectionPath, sync_run_id: uuid } as const;
const windowRequest = z
  .object({
    project_id: z.uuid().optional(),
    window_start: z.iso.date().optional(),
    window_end: z.iso.date().optional(),
  })
  .strict();
const discoveryRequest = z.object({ project_id: z.uuid().optional() }).strict();
const mappingRequest = z
  .object({
    provider: z.enum(['gsc', 'ga4', 'bing']),
    property_ref: z.string().min(1).max(512),
    project_id: z.uuid(),
  })
  .strict();
const providerPath = { provider: { scalar: { kind: 'str' }, required: true } } as const;
const oauthCookie = integrationPolicy.transport.INTEGRATION_OAUTH_TRANSACTION_COOKIE;
const logger = getLogger('api.integrations');

/** Land on the screen that started the flow (a validated app path), else Settings. */
function oauthLanding(
  params: Record<string, string>,
  clearCookie = false,
  returnTo: string | null = null,
): Response {
  const client = new IntegrationClient();
  const target = new URL(
    returnTo ?? integrationPolicy.transport.INTEGRATION_OAUTH_LANDING_PATH,
    `${client.secrets.frontendUrl}/`,
  );
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  const headers = new Headers({ location: target.toString() });
  if (clearCookie) headers.append('set-cookie', `${oauthCookie}=; ${oauthCookieOptions(0)}`);
  return new Response(null, { status: 302, headers });
}

function cookieValue(header: string | undefined, name: string): string {
  const pair = header
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? '';
}

/**
 * One mapped property's on-demand run: the new run, the run already syncing it,
 * `syncing` when that run has no trackable record, or null when the target no
 * longer resolves.
 */
async function onDemandRun(
  db: Database,
  workspaceId: string,
  target: { mapping_id: string; connection_id: string; project_id: string },
) {
  try {
    return await enqueueSyncRun(db, {
      workspaceId,
      connectionId: target.connection_id,
      mappingId: target.mapping_id,
      projectId: target.project_id,
      syncKind: 'on_demand',
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'sync_target_unresolved') return null;
    // A property already syncing is current once that run finishes, so the
    // page tracks that run instead of a new one.
    if (error instanceof ApiError && error.code === 'sync_active_window_conflict')
      return (await activePropertySync(db, workspaceId, target.mapping_id)) ?? 'syncing';
    throw error;
  }
}

function integrationFailure(error: unknown): never {
  if (error instanceof IntegrationError) {
    const status = error.code === 'property_discovery_unsupported' ? 422 : 502;
    throw new ApiError(status, error.message.slice(0, 512), {
      code: asApiErrorCode(error.code),
      retryable: error.retryable,
    });
  }
  throw error;
}

export const integrationRoutes = [
  definePostRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/run',
    capability: 'run',
    params: {
      path: connectionPath,
      query: {
        sync_run_id: { scalar: { kind: 'uuid' } },
        mapping_id: { scalar: { kind: 'uuid' } },
      },
    },
    response: z.null(),
    async handle({ c, db, config }, { path, query }) {
      const workspaceId = c.get('workspace').workspaceId;
      const connection = await db
        .selectFrom('integration_connections')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', path.connection_id)
        .executeTakeFirst();
      if (!connection) throw notFound('Integration connection');
      await executeInteractiveSyncs(db, config, workspaceId, path.connection_id, {
        runId: query.sync_run_id ?? undefined,
        mappingId: query.mapping_id ?? undefined,
      });
      return null;
    },
  }),
  definePostRoute({
    family: 'performance-sync',
    path: '/api/v1/projects/{project_id}/performance/sync',
    status: 202,
    capability: 'run',
    authorize: 'project',
    params: { path: { project_id: uuid }, query: {} },
    response: performanceSyncEnqueueResponseSchema,
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const targets = await db
        .selectFrom('integration_property_mappings as mapping')
        .innerJoin(
          'integration_connections as connection',
          'connection.id',
          'mapping.connection_id',
        )
        .innerJoin('integration_oauth_grants as grant', (join) =>
          join
            .onRef('grant.id', '=', 'connection.grant_id')
            .onRef('grant.workspace_id', '=', 'connection.workspace_id'),
        )
        .select(['mapping.id as mapping_id', 'mapping.connection_id', 'mapping.project_id'])
        .where('mapping.workspace_id', '=', workspaceId)
        .where('mapping.project_id', '=', path.project_id)
        .where('mapping.status', '=', 'active')
        .where('grant.status', '=', 'connected')
        // Keep Bing imports current too; the Performance tables simply do not
        // project Bing rows.
        .where('connection.provider', 'in', ['gsc', 'ga4', 'bing'])
        .orderBy('mapping.created_at', 'asc')
        .orderBy('mapping.id', 'asc')
        .execute();
      const queued = [];
      let syncing = 0;
      for (const target of targets) {
        const run = await onDemandRun(db, workspaceId, target);
        if (run === 'syncing') syncing++;
        else if (run) queued.push(run);
      }
      if (queued.length === 0 && syncing > 0)
        throw new ApiError(409, 'A sync is already running for this project', {
          code: 'sync_active_window_conflict',
          details: { error: 'sync_active_window_conflict', enqueued_connection_ids: [] },
        });
      return performanceSyncEnqueueResponseSchema.parse(queued);
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/integrations/workspaces/{workspace_id}/oauth/{provider}/start',
    authorize: 'workspace-path',
    capability: 'manage_credentials',
    raw: true,
    params: {
      path: { workspace_id: uuid, ...providerPath },
      query: { return_to: { scalar: { kind: 'str' }, required: false } },
    },
    response: z.null(),
    async handle({ c, db }, { path, query }) {
      if (!providerKnown(path.provider)) throw notFound('Integration provider');
      const returnTo = oauthReturnPath(query.return_to);
      try {
        const started = await startOAuth(db, {
          workspaceId: c.get('workspace').workspaceId,
          userId: c.get('user').id,
          provider: path.provider,
          returnTo,
        });
        const headers = new Headers({ location: started.url });
        headers.append(
          'set-cookie',
          `${oauthCookie}=${started.nonce}; ${oauthCookieOptions(started.maxAge)}`,
        );
        return new Response(null, { status: 302, headers });
      } catch (error) {
        // A full-page navigation: land back on the screen with the reason
        // rather than a JSON body the browser would render as the page.
        if (error instanceof IntegrationError)
          return oauthLanding({ error: error.code }, false, returnTo);
        throw error;
      }
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/integrations/oauth/{provider}/callback',
    authorize: 'public',
    raw: true,
    params: {
      path: providerPath,
      query: {
        code: { scalar: { kind: 'str' }, required: false },
        state: { scalar: { kind: 'str' }, required: false },
        error: { scalar: { kind: 'str' }, required: false },
      },
    },
    response: z.null(),
    async handle({ c, db }, { path, query }) {
      if (!providerKnown(path.provider)) throw notFound('Integration provider');
      const invalid = { error: 'oauth_state_invalid' };
      const returnTo = await stateReturnPath(query.state);
      if (query.error) return oauthLanding({ error: 'oauth_exchange_failed' }, true, returnTo);
      if (!query.code || !query.state) return oauthLanding(invalid, true, returnTo);
      const nonce = cookieValue(c.req.header('cookie'), oauthCookie);
      try {
        await completeOAuth(db, {
          provider: path.provider,
          code: query.code,
          state: query.state,
          nonce,
        });
        return oauthLanding({ connected: path.provider }, true, returnTo);
      } catch (error) {
        const code = error instanceof IntegrationError ? error.code : 'oauth_exchange_failed';
        return oauthLanding({ error: code }, true, returnTo);
      }
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/integrations',
    params: { path: {}, query: {} },
    response: integrationConnectionListSchema,
    async handle({ c, db }) {
      const rows = await db
        .selectFrom('integration_connections as connection')
        .innerJoin('integration_oauth_grants as grant', (join) =>
          join
            .onRef('grant.id', '=', 'connection.grant_id')
            .onRef('grant.workspace_id', '=', 'connection.workspace_id'),
        )
        .select([
          'connection.id',
          'connection.workspace_id',
          'connection.grant_id',
          'connection.provider',
          'connection.label',
          'connection.account_ref',
          'grant.status as grant_status',
          'grant.granted_scopes',
          'connection.last_synced_at',
          'connection.created_at',
          'connection.updated_at',
        ])
        .where('connection.workspace_id', '=', c.get('workspace').workspaceId)
        .orderBy('connection.created_at', 'asc')
        .orderBy('connection.id', 'asc')
        .execute();
      return integrationConnectionListSchema.parse(
        rows.map((row) => ({
          id: row.id,
          workspace_id: row.workspace_id,
          grant_id: row.grant_id,
          provider: row.provider,
          label: row.label,
          account_ref: row.account_ref,
          grant_status: row.grant_status,
          granted_scopes: Array.isArray(row.granted_scopes)
            ? row.granted_scopes.filter((scope): scope is string => typeof scope === 'string')
            : [],
          last_synced_at: row.last_synced_at?.toISOString() ?? null,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        })),
      );
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/syncs/progress',
    params: { path: connectionPath, query: {} },
    response: integrationBackfillProgressSchema,
    async handle({ c, db }, { path }) {
      return integrationBackfillProgressSchema.parse(
        await getBackfillProgress(db, c.get('workspace').workspaceId, path.connection_id),
      );
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/syncs/{sync_run_id}',
    params: { path: syncPath, query: {} },
    response: integrationSyncRunSchema,
    async handle({ c, db }, { path }) {
      const row = await getSyncRun(
        db,
        c.get('workspace').workspaceId,
        path.connection_id,
        path.sync_run_id,
      );
      if (row === undefined) throw notFound('Integration sync run');
      return integrationSyncRunSchema.parse(row);
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/mappings',
    params: { path: connectionPath, query: {} },
    response: integrationPropertyMappingListSchema,
    async handle({ c, db }, { path }) {
      return integrationPropertyMappingListSchema.parse(
        await listMappings(db, c.get('workspace').workspaceId, path.connection_id),
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/properties',
    capability: 'manage_credentials',
    params: { path: connectionPath, query: {} },
    body: discoveryRequest.nullable().optional(),
    response: integrationPropertyListSchema,
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const body = await readOptionalBody(c, discoveryRequest);
      const row = await db
        .selectFrom('integration_connections as connection')
        .innerJoin('integration_oauth_grants as grant', (join) =>
          join
            .onRef('grant.id', '=', 'connection.grant_id')
            .onRef('grant.workspace_id', '=', 'connection.workspace_id'),
        )
        .select(['connection.provider', 'connection.grant_id'])
        .where('connection.id', '=', path.connection_id)
        .where('connection.workspace_id', '=', workspaceId)
        .executeTakeFirst();
      if (!row) throw notFound('Integration connection');
      await enforceWorkspaceRequest(db, `${workspaceId}:${path.connection_id}`, {
        operation: 'integrations.properties',
        limit: resolveSettingSpec(policy.abuse.property_discovery_limit) as number,
        windowSeconds: resolveSettingSpec(policy.abuse.property_discovery_window_seconds) as number,
      });
      // Resolve the project before provider I/O; an unknown project is a 404,
      // and any other failure keeps its own error.
      let sites: Set<string> | null = null;
      if (body?.project_id) {
        sites = await projectSiteDomains(db, workspaceId, body.project_id);
        if (!sites) throw notFound('Project');
      }
      let properties;
      try {
        const token = await freshAccessToken(db, row.grant_id, workspaceId);
        properties = await new IntegrationClient().properties(
          row.provider as 'gsc' | 'ga4' | 'bing',
          token,
        );
      } catch (error) {
        return integrationFailure(error);
      }
      // GA4 summaries carry no site URL, so a GA4 match stays unknown (null).
      return properties.map((property) => ({
        ...property,
        matches_project:
          sites === null || row.provider === 'ga4'
            ? null
            : propertyMatchesSite(property.property_ref, sites),
      }));
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/sync',
    status: 202,
    capability: 'run',
    params: { path: connectionPath, query: {} },
    body: windowRequest.nullable().optional(),
    response: integrationSyncEnqueueSchema,
    async handle({ c, db }, { path }) {
      const body = await readOptionalBody(c, windowRequest);
      if (body === null || body === undefined)
        return integrationSyncEnqueueSchema.parse(
          await enqueueSyncRun(db, {
            workspaceId: c.get('workspace').workspaceId,
            connectionId: path.connection_id,
          }),
        );
      return integrationSyncEnqueueSchema.parse(
        await enqueueSyncRun(db, {
          workspaceId: c.get('workspace').workspaceId,
          connectionId: path.connection_id,
          projectId: body.project_id,
          windowStart: body.window_start,
          windowEnd: body.window_end,
        }),
      );
    },
  }),
  defineDeleteRoute({
    family,
    path: '/api/v1/integrations/{connection_id}',
    capability: 'manage_credentials',
    params: { path: connectionPath, query: {} },
    /**
     * Disconnect the connection's OAuth grant: revoke it and retire every
     * property mapping it serves. Connections and their imported evidence stay
     * (raw evidence is append-only), so a reconnect resumes the same history.
     */
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await db.transaction().execute(async (trx) => {
        const connection = await trx
          .selectFrom('integration_connections')
          .selectAll()
          .where('id', '=', path.connection_id)
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
          await enqueueTrafficInsights(trx, { workspaceId, projectId }); // NOSONAR -- One transaction runs one statement at a time.
        await trx
          .insertInto('integration_events')
          .values({
            id: crypto.randomUUID(),
            workspace_id: workspaceId,
            connection_id: connection.id,
            grant_id: grant.id,
            event_type: 'integration.disconnected',
            message: 'Integration disconnected',
            payload: JSON.stringify({
              provider: connection.provider,
              retired_mappings: retired.length,
            }),
            created_at: now,
          })
          .execute();
      });
    },
  }),
  defineDeleteRoute({
    family,
    path: '/api/v1/integrations/mappings/{mapping_id}',
    capability: 'manage_credentials',
    params: { path: { mapping_id: uuid }, query: {} },
    async handle({ c, db }, { path }) {
      const mapping = await db
        .selectFrom('integration_property_mappings')
        .select(['id', 'project_id'])
        .where('id', '=', path.mapping_id)
        .where('workspace_id', '=', c.get('workspace').workspaceId)
        .executeTakeFirst();
      if (mapping === undefined) throw notFound('Integration property mapping');
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('integration_property_mappings')
          .set({ status: 'disabled', updated_at: new Date() })
          .where('id', '=', path.mapping_id)
          .where('workspace_id', '=', c.get('workspace').workspaceId)
          .execute();
        await enqueueTrafficInsights(trx, {
          workspaceId: c.get('workspace').workspaceId,
          projectId: mapping.project_id,
        });
      });
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/mappings',
    status: 201,
    // A mapping spends the connecting admin's provider grant, so it needs their authority.
    capability: 'manage_credentials',
    params: { path: connectionPath, query: {} },
    body: mappingRequest,
    response: integrationPropertyMappingListSchema.element,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, mappingRequest);
      const workspaceId = c.get('workspace').workspaceId;
      const mapping = await db.transaction().execute(async (trx) => {
        const connection = await trx
          .selectFrom('integration_connections')
          .selectAll()
          .where('id', '=', path.connection_id)
          .where('workspace_id', '=', workspaceId)
          .forUpdate()
          .executeTakeFirst();
        if (!connection) throw notFound('Integration connection');
        if (connection.provider !== input.provider)
          throw new ApiError(422, 'The mapping provider does not match the connection provider', {
            code: 'mapping_provider_mismatch',
          });
        const project = await trx
          .selectFrom('projects')
          .select(['id', 'website_url'])
          .where('id', '=', input.project_id)
          .where('workspace_id', '=', workspaceId)
          .executeTakeFirst();
        if (!project) throw notFound('Project');
        let ref = input.property_ref.trim();
        if (input.provider === 'ga4') {
          ref = ref.replace(/^properties\//u, '');
          if (!/^\d+$/u.test(ref))
            throw new ApiError(422, 'The property does not belong to the selected project', {
              code: 'mapping_property_not_owned',
            });
        } else if (!propertyMatchesSite(ref, await siteDomainsOf(trx, project))) {
          throw new ApiError(422, 'The property does not belong to the selected project', {
            code: 'mapping_property_not_owned',
          });
        }
        await trx
          .updateTable('integration_property_mappings')
          .set({ status: 'disabled', updated_at: new Date() })
          .where('workspace_id', '=', workspaceId)
          .where('connection_id', '=', connection.id)
          .where('project_id', '=', project.id)
          .where('status', '=', 'active')
          .where('property_ref', '!=', ref)
          .execute();
        const existing = await trx
          .selectFrom('integration_property_mappings')
          .selectAll()
          .where('workspace_id', '=', workspaceId)
          .where('connection_id', '=', connection.id)
          .where('project_id', '=', project.id)
          .where('property_ref', '=', ref)
          .where('status', '=', 'active')
          .forUpdate()
          .executeTakeFirst();
        await enqueueTrafficInsights(trx, { workspaceId, projectId: project.id });
        if (existing)
          return {
            ...existing,
            created_at: existing.created_at.toISOString(),
            updated_at: existing.updated_at.toISOString(),
          };
        await trx
          .updateTable('integration_connections')
          .set({ account_ref: ref, updated_at: new Date() })
          .where('id', '=', connection.id)
          .where('workspace_id', '=', workspaceId)
          .execute();
        const id = crypto.randomUUID();
        const now = new Date();
        try {
          await trx
            .insertInto('integration_property_mappings')
            .values({
              id,
              workspace_id: workspaceId,
              connection_id: connection.id,
              provider: input.provider,
              property_ref: ref,
              project_id: project.id,
              status: 'active',
              created_at: now,
              updated_at: now,
            })
            .execute();
        } catch (error) {
          if (String(error).includes('ix_integration_property_mappings_active_owner')) {
            throw new ApiError(409, 'An active mapping already owns this property', {
              code: 'mapping_active_owner_conflict',
            });
          }
          throw error;
        }
        return {
          id,
          workspace_id: workspaceId,
          connection_id: connection.id,
          provider: input.provider,
          property_ref: ref,
          project_id: project.id,
          status: 'active',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        };
      });
      try {
        await enqueueHistoryBackfill(db, {
          workspaceId,
          connectionId: path.connection_id,
          mappingId: mapping.id,
          projectId: mapping.project_id,
          propertyRef: mapping.property_ref,
        });
      } catch (error) {
        logger.exception('integration_backfill_enqueue_incomplete', error, {
          connection_id: path.connection_id,
        });
        throw new ApiError(
          503,
          'The mapping was saved, but its history import could not be queued. Retry saving the mapping.',
          {
            details: { mapping_id: mapping.id },
          },
        );
      }
      return integrationPropertyMappingListSchema.element.parse(mapping);
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/integrations/{connection_id}/test',
    capability: 'manage_credentials',
    params: { path: connectionPath, query: {} },
    response: integrationTestResultSchema,
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      const row = await db
        .selectFrom('integration_connections as connection')
        .innerJoin('integration_oauth_grants as grant', (join) =>
          join
            .onRef('grant.id', '=', 'connection.grant_id')
            .onRef('grant.workspace_id', '=', 'connection.workspace_id'),
        )
        .select(['connection.provider', 'connection.grant_id', 'connection.account_ref'])
        .where('connection.id', '=', path.connection_id)
        .where('connection.workspace_id', '=', workspaceId)
        .executeTakeFirst();
      if (!row) throw notFound('Integration connection');
      const testedAt = new Date();
      let status = 'ok';
      let errorCode = '';
      let detail = '';
      try {
        const token = await freshAccessToken(db, row.grant_id, workspaceId);
        const properties = await new IntegrationClient().properties(
          row.provider as 'gsc' | 'ga4' | 'bing',
          token,
        );
        if (
          row.account_ref &&
          !properties.some((property) => property.property_ref === row.account_ref)
        ) {
          throw new IntegrationError(
            integrationPolicy.contracts.ERROR_PROPERTY_NOT_ACCESSIBLE,
            'The authorized account cannot access the selected property',
          );
        }
      } catch (error) {
        status = 'failed';
        errorCode =
          error instanceof IntegrationError
            ? error.code
            : integrationPolicy.contracts.ERROR_PROVIDER_API;
        detail =
          error instanceof IntegrationError
            ? error.message.slice(0, 512)
            : 'Integration provider request failed';
      }
      await db
        .insertInto('integration_events')
        .values({
          id: crypto.randomUUID(),
          workspace_id: workspaceId,
          connection_id: path.connection_id,
          grant_id: row.grant_id,
          event_type: 'integration.tested',
          message: 'Integration connection tested',
          payload: JSON.stringify({ status, error_code: errorCode }),
          created_at: testedAt,
        })
        .execute();
      return {
        connection_id: path.connection_id,
        status,
        error_code: errorCode,
        detail,
        tested_at: testedAt.toISOString(),
      };
    },
  }),
];
