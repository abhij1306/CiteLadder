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
  getConnectionStates: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<unknown>('/provider-connections/states', options);
    return strictValidate(providerConnectionStatesSchema, res, 'providers.getConnectionStates');
  },
};

export const providerQueries = {
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
  states: (workspaceId: string | null) =>
    queryOptions({
      queryKey: queryKeys.providers.states(workspaceId ?? 'unresolved'),
      queryFn: ({ signal }) => providersApi.getConnectionStates({ signal, workspaceId }),
    }),
};

export const refreshProviderReads = (client: QueryClient) =>
  Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.providers.allConnections() }),
    client.invalidateQueries({ queryKey: queryKeys.providers.allStates() }),
  ]);
