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
import { strictValidate } from '@citeladder/contracts/validation';
import type {
  LogicalEngine,
  ProviderCatalog,
  ProviderConnection,
  TransportProvider,
} from './types';

const connectionListSchema = z.array(providerConnectionSchema);

type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

/** A route entry sent on create/update (`ProviderRouteInput`). */
type ProviderRouteInput = {
  logical_engine: LogicalEngine;
  is_default?: boolean;
};

/**
 * A connection write. The credential is supplied in exactly ONE shape: a
 * bearer `api_key`, or an HTTP Basic `api_login` + `api_password` pair. The
 * backend rejects the wrong shape for a transport, and rejects half a pair,
 * so a mismatch fails at the edge rather than at the first paid task.
 */
type ProviderConnectionInput = {
  transport_provider: TransportProvider;
  api_key?: string;
  api_login?: string;
  api_password?: string;
  base_url?: string;
  label?: string;
  active?: boolean;
  routes?: ProviderRouteInput[];
  confirm_destination_change?: boolean;
};

export const providersApi = {
  listConnections: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<ProviderConnection[]>('/provider-connections', options);
    return strictValidate(connectionListSchema, res, 'providers.listConnections');
  },
  createConnection: async (input: ProviderConnectionInput, options?: ApiRequestOptions) => {
    const res = await apiClient.post<ProviderConnection>('/provider-connections', input, options);
    return strictValidate(providerConnectionSchema, res, 'providers.createConnection');
  },
  updateConnection: async (
    connectionId: string,
    input: Partial<ProviderConnectionInput> & { active?: boolean },
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
