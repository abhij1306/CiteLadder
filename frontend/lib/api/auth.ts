/**
 * The local user. A self-hosted CiteLadder has no sign-in: every request acts
 * as the one local user the API provisions. Every response passes through
 * `strictValidate`.
 */
import { queryOptions } from '@tanstack/react-query';

import { getBootstrapReadTimeoutMs } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import { authResponseSchema } from '@citeladder/contracts/auth';
import { strictValidate } from '@citeladder/contracts/validation';
import type { AuthResponse } from '@citeladder/contracts';

export const authApi = {
  me: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<AuthResponse>('/auth/me', options);
    return strictValidate(authResponseSchema, res, 'auth.me').user;
  },
};

export const authQueries = {
  /**
   * The session. Every protected route blocks on it, so it carries the bounded
   * bootstrap timeout: a stalled connection reaches the notice-and-retry path
   * instead of waiting out the full request timeout.
   */
  me: () =>
    queryOptions({
      queryKey: queryKeys.auth.me(),
      queryFn: ({ signal }) => authApi.me({ signal, timeoutMs: getBootstrapReadTimeoutMs() }),
    }),
};
