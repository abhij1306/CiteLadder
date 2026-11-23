import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';

import {
  apiKeyCreatedSchema,
  apiKeyListSchema,
  apiKeySchema,
  type ApiKeyCreate,
} from '@citeladder/contracts/api-keys';
import { strictValidate } from '@citeladder/contracts/validation';

import { apiClient } from './client';
import { queryKeys } from './query-keys';

export const apiKeysApi = {
  list: async (workspaceId: string, signal?: AbortSignal) =>
    strictValidate(
      apiKeyListSchema,
      await apiClient.get<unknown>('/api-keys', { workspaceId, signal }),
      'api-keys.list',
    ),
  create: async (workspaceId: string, input: ApiKeyCreate) =>
    strictValidate(
      apiKeyCreatedSchema,
      await apiClient.post<unknown>('/api-keys', input, { workspaceId }),
      'api-keys.create',
    ),
  revoke: async (workspaceId: string, keyId: string) =>
    strictValidate(
      apiKeySchema,
      await apiClient.post<unknown>(`/api-keys/${keyId}/revoke`, {}, { workspaceId }),
      'api-keys.revoke',
    ),
  remove: (workspaceId: string, keyId: string) =>
    apiClient.delete<void>(`/api-keys/${keyId}`, { workspaceId }),
};

export const apiKeyQueries = {
  list: (workspaceId: string) =>
    queryOptions({
      queryKey: queryKeys.apiKeys.list(workspaceId),
      queryFn: ({ signal }) => apiKeysApi.list(workspaceId, signal),
    }),
};

const refreshApiKeys = (client: QueryClient) => {
  void client.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
};

export const apiKeyMutations = {
  create: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (input: ApiKeyCreate) => apiKeysApi.create(workspaceId, input),
      onSuccess: (_created, _input, _result, { client }) => refreshApiKeys(client),
    }),
  revoke: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (keyId: string) => apiKeysApi.revoke(workspaceId, keyId),
      onSuccess: (_key, _keyId, _result, { client }) => refreshApiKeys(client),
    }),
  remove: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (keyId: string) => apiKeysApi.remove(workspaceId, keyId),
      onSuccess: (_data, _keyId, _result, { client }) => refreshApiKeys(client),
    }),
};
