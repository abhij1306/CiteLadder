/**
 * The local user. A self-hosted CiteLadder has no sign-in: every request acts
 * as the one local user the API provisions. Every response passes through
 * `strictValidate`.
 */
import { apiClient, type ApiRequestOptions } from './client';
import { authResponseSchema } from '@citeladder/contracts/auth';
import { strictValidate } from '@citeladder/contracts/validation';
import type { AuthResponse } from './types';

export const authApi = {
  me: async (options?: ApiRequestOptions) => {
    const res = await apiClient.get<AuthResponse>('/auth/me', options);
    return strictValidate(authResponseSchema, res, 'auth.me').user;
  },
};
