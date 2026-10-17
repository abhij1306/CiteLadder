import { z } from 'zod';
import {
  connectionTestResultSchema,
  providerCatalogSchema,
  providerConnectionSchema,
} from '@citeladder/contracts/providers';
import { providerConnectionStatesSchema } from '@citeladder/contracts/providers';
import { policy, resolveSettingSpec } from '../config.ts';
import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { readBody } from '../http/body.ts';
import {
  createConnection,
  updateConnection,
  deleteConnection,
  getConnection,
  connectionResponse,
  tenantConnections,
  provisionRoutes,
} from '../providers/connections.ts';
import { createConnectionInput, updateConnectionInput } from '../providers/inputs.ts';
import { providerPolicy, providerSettings } from '../providers/config.ts';
import { connectionStates } from '../providers/states.ts';
import { probeConnection } from '../providers/probes.ts';
import { defineGetRoute, definePostRoute, definePatchRoute, defineDeleteRoute } from './define.ts';

const family = 'providers';
const params = {
  path: { connection_id: { scalar: { kind: 'uuid' }, required: true } },
  query: {},
} as const;
const empty = { path: {}, query: {} } as const;
const encryptionKey = () => String(resolveSettingSpec(policy.settings.encryption_key));
export const providerRoutes = [
  defineGetRoute({
    family,
    path: '/api/v1/provider-catalog',
    authorize: 'public',
    params: empty,
    response: providerCatalogSchema,
    handle() {
      return Promise.resolve({
        transports: providerPolicy.transports as (
          | 'openai'
          | 'anthropic'
          | 'google'
          | 'dataforseo'
        )[],
        engines: Object.entries(providerPolicy.routes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([engine, route]) => ({
            logical_engine: engine as keyof typeof providerPolicy.routes,
            routes: [
              {
                transport_provider: route.transport_provider as
                  | 'openai'
                  | 'anthropic'
                  | 'google'
                  | 'dataforseo',
                transport_model: route.transport_model,
                retrieval_enabled: route.retrieval_enabled,
                reasoning_effort: route.reasoning_effort,
                surface_kind: route.surface_kind as 'llm' | 'search_ai' | 'llm_scraper',
              },
            ],
          })),
      });
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/provider-connections',
    params: empty,
    response: z.array(providerConnectionSchema),
    async handle({ c, db }) {
      const rows = await tenantConnections(db, c.get('workspace').workspaceId)
        .orderBy('c.created_at', 'desc')
        .execute();
      return Promise.all(rows.map((row) => connectionResponse(db, row)));
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/provider-connections/states',
    params: empty,
    response: providerConnectionStatesSchema,
    async handle({ c, db }) {
      return connectionStates(db, c.get('workspace').workspaceId);
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/provider-connections',
    params: empty,
    status: 201,
    capability: 'manage_credentials',
    body: createConnectionInput,
    response: providerConnectionSchema,
    async handle({ c, db }) {
      return createConnection(
        db,
        c.get('workspace').workspaceId,
        c.get('user').id,
        await readBody(c, createConnectionInput),
        encryptionKey(),
        providerSettings(),
      );
    },
  }),
  definePatchRoute({
    family,
    path: '/api/v1/provider-connections/{connection_id}',
    params,
    capability: 'manage_credentials',
    body: updateConnectionInput,
    response: providerConnectionSchema,
    async handle({ c, db }, { path }) {
      return updateConnection(
        db,
        c.get('workspace').workspaceId,
        c.get('user').id,
        path.connection_id,
        await readBody(c, updateConnectionInput),
        encryptionKey(),
        providerSettings(),
      );
    },
  }),
  defineDeleteRoute({
    family,
    path: '/api/v1/provider-connections/{connection_id}',
    params,
    capability: 'manage_credentials',
    async handle({ c, db }, { path }) {
      await deleteConnection(
        db,
        c.get('workspace').workspaceId,
        c.get('user').id,
        path.connection_id,
      );
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/provider-connections/{connection_id}/provision-dataforseo-routes',
    params,
    capability: 'manage_credentials',
    response: providerConnectionSchema,
    async handle({ c, db }, { path }) {
      return provisionRoutes(db, c.get('workspace').workspaceId, path.connection_id);
    },
  }),
  definePostRoute({
    family,
    path: '/api/v1/provider-connections/{connection_id}/test',
    params,
    capability: 'manage_credentials',
    response: connectionTestResultSchema,
    async handle({ c, db }, { path }) {
      const workspaceId = c.get('workspace').workspaceId;
      await getConnection(db, workspaceId, path.connection_id);
      await enforceWorkspaceRequest(db, workspaceId, {
        operation: 'provider.connection_test',
        limit: Number(resolveSettingSpec(policy.abuse.provider_test_limit)),
        windowSeconds: Number(resolveSettingSpec(policy.abuse.provider_test_window_seconds)),
      });
      return probeConnection(
        db,
        workspaceId,
        path.connection_id,
        encryptionKey(),
        providerSettings(),
      );
    },
  }),
];
