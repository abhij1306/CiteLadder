import {
  apiKeyCreatedSchema,
  apiKeyListSchema,
  apiKeySchema,
  type ApiKeyCreate,
} from '@citeladder/contracts/api-keys';
import { strictValidate } from '@citeladder/contracts/validation';

import { apiClient } from './client';

/** The active workspace's public API keys (Owner/Admin). */
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
};
