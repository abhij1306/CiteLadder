/**
 * Providers domain endpoints: BYOK provider-connections CRUD + connection
 * test + provider-catalog. The API key is write-only — it is sent on create but
 * is **never** present on any response. Every response passes
 * through `strictValidate`.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import {
  connectionTestResultSchema,
  providerConnectionStatesSchema,
  providerCatalogSchema,
  providerConnectionSchema,
} from '@citeladder/contracts/providers';
import type {
  ProviderConnectionCreateRequest,
  ProviderConnectionUpdateRequest,
} from '@citeladder/contracts/provider-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import type { ProviderCatalog, ProviderConnection } from '@citeladder/contracts';

const connectionListSchema = z.array(providerConnectionSchema);

type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export const providersApi = {
  listConnections: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<ProviderConnection[]>('/provider-connections', options);
    return strictValidate(connectionListSchema, res, 'providers.listConnections');
  },
  createConnection: async (input: ProviderConnectionCreateRequest, options?: ApiRequestOptions) => {
    const res = await apiClient.post<ProviderConnection>('/provider-connections', input, options);
    return strictValidate(providerConnectionSchema, res, 'providers.createConnection');
  },
  updateConnection: async (
    connectionId: string,
    input: ProviderConnectionUpdateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.patch<ProviderConnection>(
      `/provider-connections/${connectionId}`,
      input,
      options,
    );
    return strictValidate(providerConnectionSchema, res, 'providers.updateConnection');
  },
  deleteConnection: (connectionId: string, options?: ApiRequestOptions) =>
    apiClient.delete<void>(`/provider-connections/${connectionId}`, options),
  testConnection: async (connectionId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<ConnectionTestResult>(
      `/provider-connections/${connectionId}/test`,
      undefined,
      options,
    );
    return strictValidate(connectionTestResultSchema, res, 'providers.testConnection');
  },
  getCatalog: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<ProviderCatalog>('/provider-catalog', options);
    return strictValidate(providerCatalogSchema, res, 'providers.getCatalog');
  },
  /**
   * The AUTHENTICATED workspace projection: what this workspace can actually
   * execute with. Distinct from the public catalog's `availability` — a
   * provider can be generally available and still `missing` here.
   */
  getConnectionStates: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<unknown>('/provider-connections/states', options);
    return strictValidate(providerConnectionStatesSchema, res, 'providers.getConnectionStates');
  },
};

/**
 * Provider reads. A workspace owns its provider connections, so those reads
 * are keyed and sent for one; without that, switching workspace showed the
 * previous workspace's engines as configured. Callers hold them disabled
 * until the workspace is known.
 */
export const providerQueries = {
  /** The public catalog: which transports exist and the engines each measures. */
  catalog: () =>
    queryOptions({
      queryKey: queryKeys.providers.catalog(),
      queryFn: ({ signal }) => providersApi.getCatalog({ signal, workspaceId: null }),
    }),
  connections: (workspaceId: string | null) =>
    queryOptions({
      queryKey: queryKeys.providers.connections(workspaceId ?? 'unresolved'),
      queryFn: ({ signal }) => providersApi.listConnections({ signal, workspaceId }),
    }),
  /**
   * The AUTHENTICATED state projection. A failure leaves every engine at its
   * fail-closed default rather than implying `connected`.
   */
  states: (workspaceId: string | null) =>
    queryOptions({
      queryKey: queryKeys.providers.states(workspaceId ?? 'unresolved'),
      queryFn: ({ signal }) => providersApi.getConnectionStates({ signal, workspaceId }),
    }),
};

/**
 * Every workspace's connections and states, after a save or a probe: the
 * probe denormalizes its outcome onto the connection, and that outcome gates
 * launching and the status badge.
 */
export const refreshProviderReads = (client: QueryClient) =>
  Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.providers.allConnections() }),
    client.invalidateQueries({ queryKey: queryKeys.providers.allStates() }),
  ]);
