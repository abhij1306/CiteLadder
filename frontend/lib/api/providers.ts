/**
 * Providers domain endpoints: BYOK provider-connections CRUD + connection
 * test + provider-catalog. The API key is write-only — it is sent on create but
 * is **never** present on any response. Every response passes
 * through `strictValidate`.
 */
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { providerConnectionStatesSchema } from '@citeladder/contracts/providers';
import {
  connectionTestResultSchema,
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

// Re-export so the logical-engine literal union is importable without
// reaching into `schemas`.
