/**
 * Integrations domain endpoints: GSC/GA4/Bing connection management —
 * list, test, sync, sync-run detail, disconnect — plus the OAuth
 * start URL used for full-page 302 navigation.
 *
 * Owns transport for the integrations slice. Every JSON response passes
 * through `strictValidate` (fail loud on any drift). All paths are relative
 * `/api/v1` (same-origin proxy). Tokens are Fernet-encrypted
 * on the backend grant and are NEVER present on any response — the
 * integration response schemas throw on any leaked token-shaped key.
 */
import { mutationOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { API_BASE_URL } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { startInteractiveWork } from './interactive-work';
import { queryKeys } from './query-keys';
import {
  integrationBackfillProgressSchema,
  integrationConnectionListSchema,
  integrationPropertyListSchema,
  integrationPropertyMappingListSchema,
  integrationPropertyMappingSchema,
  integrationSyncEnqueueSchema,
  integrationSyncRunSchema,
  integrationTestResultSchema,
  type integrationConnectionSchema,
  type integrationPropertySchema,
  type integrationProviderSchema,
  type IntegrationPropertyDiscoveryRequest,
  type IntegrationPropertyMappingRequest,
  type IntegrationSyncRequest,
} from '@citeladder/contracts/integrations';
import { strictValidate } from '@citeladder/contracts/validation';

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
export type IntegrationTestResult = z.infer<typeof integrationTestResultSchema>;
export type IntegrationSyncEnqueue = z.infer<typeof integrationSyncEnqueueSchema>;
export type IntegrationSyncRun = z.infer<typeof integrationSyncRunSchema>;
export type IntegrationBackfillProgress = z.infer<typeof integrationBackfillProgressSchema>;
export type IntegrationProperty = z.infer<typeof integrationPropertySchema>;
export type IntegrationPropertyMapping = z.infer<typeof integrationPropertyMappingSchema>;

export const integrationsApi = {
  list: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<IntegrationConnection[]>('/integrations', options);
    return strictValidate(integrationConnectionListSchema, res, 'integrations.list');
  },
  test: async (connectionId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<IntegrationTestResult>(
      `/integrations/${connectionId}/test`,
      undefined,
      options,
    );
    return strictValidate(integrationTestResultSchema, res, 'integrations.test');
  },
  sync: async (
    connectionId: string,
    input?: IntegrationSyncRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<IntegrationSyncEnqueue>(
      `/integrations/${connectionId}/sync`,
      input,
      options,
    );
    const run = strictValidate(integrationSyncEnqueueSchema, res, 'integrations.sync');
    startInteractiveWork(
      `/integrations/${connectionId}/run?sync_run_id=${run.sync_run_id}`,
      options,
    );
    return run;
  },
  /**
   * The connection's history-import rollup. A projection, so it is safe to
   * poll while an import drains — it never triggers one.
   */
  getBackfillProgress: async (connectionId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<IntegrationBackfillProgress>(
      `/integrations/${connectionId}/syncs/progress`,
      options,
    );
    return strictValidate(
      integrationBackfillProgressSchema,
      res,
      'integrations.getBackfillProgress',
    );
  },
  getSync: async (connectionId: string, syncId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<IntegrationSyncRun>(
      `/integrations/${connectionId}/syncs/${syncId}`,
      options,
    );
    return strictValidate(integrationSyncRunSchema, res, 'integrations.getSync');
  },
  delete: (connectionId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/integrations/${connectionId}`, options),
  /**
   * Provider properties this connection's grant can read — the picker's
   * options. A live provider call, so it is slower than the other reads and
   * can fail with a 502 when the upstream is down.
   */
  discoverProperties: async (
    connectionId: string,
    projectId?: string,
    options?: ApiRequestOptions,
  ) => {
    // Naming the project marks the properties that belong to its site.
    const res = await apiClient.post<IntegrationProperty[]>(
      `/integrations/${connectionId}/properties`,
      projectId
        ? ({ project_id: projectId } satisfies IntegrationPropertyDiscoveryRequest)
        : undefined,
      options,
    );
    return strictValidate(integrationPropertyListSchema, res, 'integrations.discoverProperties');
  },
  listMappings: async (connectionId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<IntegrationPropertyMapping[]>(
      `/integrations/${connectionId}/mappings`,
      options,
    );
    return strictValidate(integrationPropertyMappingListSchema, res, 'integrations.listMappings');
  },
  createMapping: async (
    connectionId: string,
    input: IntegrationPropertyMappingRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.post<IntegrationPropertyMapping>(
      `/integrations/${connectionId}/mappings`,
      input,
      options,
    );
    const mapping = strictValidate(
      integrationPropertyMappingSchema,
      res,
      'integrations.createMapping',
    );
    startInteractiveWork(`/integrations/${connectionId}/run?mapping_id=${mapping.id}`, options);
    return mapping;
  },
  deleteMapping: (mappingId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/integrations/mappings/${mappingId}`, options),
  /**
   * Same-origin OAuth start URL (a 302 endpoint). Used with a full-page
   * navigation (`hardNavigate`), NEVER through `apiClient` — the browser
   * follows the redirect to the provider consent screen through the
   * same-origin proxy.
   */
  oauthStartUrl: (provider: IntegrationProvider, workspaceId: string, returnTo?: string) => {
    const start = `${API_BASE_URL}/integrations/workspaces/${workspaceId}/oauth/${provider}/start`;
    // The callback lands back on `returnTo` (an allowed app path) instead of Settings.
    return returnTo ? `${start}?${new URLSearchParams({ return_to: returnTo })}` : start;
  },
};

/**
 * Integration reads. Connections are workspace-wide; a connection's mappings,
 * import progress and sync runs are read by the connection, in the workspace
 * that owns it.
 */
export const integrationsQueries = {
  connections: (workspaceId: string | null) =>
    queryOptions({
      queryKey: queryKeys.integrations.connections(workspaceId),
      queryFn: ({ signal }) => integrationsApi.list({ signal, workspaceId }),
    }),
  /** A connection's mappings; one cache entry shared by Settings and the setup panel. */
  mappings: (workspaceId: string | null, connectionId: string) =>
    queryOptions({
      queryKey: queryKeys.integrations.mappings(workspaceId, connectionId),
      queryFn: ({ signal }) => integrationsApi.listMappings(connectionId, { signal, workspaceId }),
      staleTime: 60 * 1000,
    }),
  backfillProgress: (workspaceId: string | null, connectionId: string) =>
    queryOptions({
      queryKey: queryKeys.integrations.backfillProgress(workspaceId, connectionId),
      queryFn: ({ signal }) =>
        integrationsApi.getBackfillProgress(connectionId, { signal, workspaceId }),
    }),
  /** One sync run; skips until a run has been enqueued. */
  sync: (workspaceId: string | null, connectionId: string, syncId: string | null) =>
    queryOptions({
      queryKey: queryKeys.integrations.sync(workspaceId, connectionId, syncId ?? ''),
      queryFn: syncId
        ? ({ signal }) => integrationsApi.getSync(connectionId, syncId, { signal, workspaceId })
        : skipToken,
    }),
};

/** The workspace's connections and everything read per connection. */
export const refreshIntegrations = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: queryKeys.integrations.all });

/**
 * Everything a property mapping, a disconnect or a settled import changes:
 * mappings, readiness and every projection fed by imported rows. Refreshed
 * at once rather than after the stale time, so a page shows the import
 * starting, or its rebuilt reports, instead of the old state. This is the one
 * place that says which domains imported rows feed.
 */
export function refreshImportedReads(client: QueryClient) {
  return Promise.all(
    [
      queryKeys.integrations.all,
      queryKeys.performance.all,
      queryKeys.demand.all,
      queryKeys.aiTraffic.all,
      queryKeys.searchIntelligence.all,
    ].map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}

/** Integration writes; each success refreshes every read it changes. */
export const integrationsMutations = {
  /**
   * The provider properties a connection's grant can read. A live provider
   * call, so a failure is shown at once rather than retried.
   */
  discoverProperties: (workspaceId: string | null, connectionId: string) =>
    mutationOptions({
      mutationFn: (projectId: string | undefined) =>
        integrationsApi.discoverProperties(connectionId, projectId, { workspaceId }),
      retry: false,
    }),
  /** Import a property into a project; the import starts at once. */
  createMapping: (workspaceId: string | null, connectionId: string) =>
    mutationOptions({
      mutationFn: (input: IntegrationPropertyMappingRequest) =>
        integrationsApi.createMapping(connectionId, input, { workspaceId }),
      onSuccess: (_mapping, _input, _result, { client }) => refreshImportedReads(client),
    }),
  /** Stop importing a property into its project; imported data stays. */
  deleteMapping: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (mappingId: string) => integrationsApi.deleteMapping(mappingId, { workspaceId }),
      onSuccess: (_data, _mappingId, _result, { client }) => refreshImportedReads(client),
    }),
  /**
   * Disconnect a grant: every property it serves stops importing into the
   * projections a new property feeds. Imported data is kept. The grant is
   * gone once the delete answers, so the mutation settles there and the reads
   * refresh behind it: the caller's confirmation closes without waiting on them.
   */
  disconnect: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (connectionId: string) => integrationsApi.delete(connectionId, { workspaceId }),
      onSuccess: (_data, _connectionId, _result, { client }) => {
        void refreshImportedReads(client);
      },
    }),
  test: (workspaceId: string | null, connectionId: string) =>
    mutationOptions({ mutationFn: () => integrationsApi.test(connectionId, { workspaceId }) }),
  /**
   * Enqueue a sync. Enqueueing alone persists no projection: the run's
   * terminal poll refreshes the imported reads.
   */
  sync: (workspaceId: string | null, connectionId: string) =>
    mutationOptions({
      mutationFn: (input: IntegrationSyncRequest) =>
        integrationsApi.sync(connectionId, input, { workspaceId }),
    }),
};
