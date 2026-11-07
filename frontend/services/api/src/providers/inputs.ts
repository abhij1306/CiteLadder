import {
  providerConnectionCreateRequestSchema,
  providerConnectionUpdateRequestSchema,
} from '@citeladder/contracts/provider-requests';
import type { z } from 'zod';

export const createConnectionInput = providerConnectionCreateRequestSchema.superRefine(
  (input, ctx) => {
    const pair = input.transport_provider === 'dataforseo';
    if (
      (pair && (input.api_key || !input.api_login.trim() || !input.api_password)) ||
      (!pair && (!input.api_key.trim() || input.api_login || input.api_password))
    )
      ctx.addIssue({ code: 'custom', message: 'Credentials must match the provider transport' });
  },
);
export const updateConnectionInput = providerConnectionUpdateRequestSchema.superRefine(
  (input, ctx) => {
    const login = input.api_login?.trim() || '';
    const password = input.api_password || '';
    if (Boolean(login) !== Boolean(password) || (input.api_key?.trim() && (login || password)))
      ctx.addIssue({ code: 'custom', message: 'Supply a key or both credential halves' });
  },
);
export type ConnectionCreate = z.output<typeof createConnectionInput>;
export type ConnectionUpdate = z.output<typeof updateConnectionInput>;
