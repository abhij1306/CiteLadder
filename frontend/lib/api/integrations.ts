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
import type { z } from 'zod';

import { API_BASE_URL, apiClient, type ApiRequestOptions } from './client';
import { startInteractiveWork } from './interactive-work';
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

/** Body for `POST /integrations/{id}/mappings`. */
export type PropertyMappingInput = {
  provider: IntegrationProvider;
  property_ref: string;
  project_id: string;
};

/** Optional body for `POST /integrations/{id}/sync`: the project and window (ISO dates). */
export type SyncWindowInput = {
  project_id?: string;
  window_start?: string;
  window_end?: string;
};

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
  sync: async (connectionId: string, input?: SyncWindowInput, options?: ApiRequestOptions) => {
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
      projectId ? { project_id: projectId } : undefined,
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
    input: PropertyMappingInput,
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
