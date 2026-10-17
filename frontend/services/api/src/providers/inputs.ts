import { z } from 'zod';
import { logicalEngineSchema, transportProviderSchema } from '@citeladder/contracts/providers';

const endpoint = z
  .string()
  .max(1024)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, 'Provider endpoint is invalid');
const routes = z
  .array(
    z.object({
      logical_engine: logicalEngineSchema,
      is_default: z.boolean().default(false),
    }),
  )
  .refine(
    (items) => new Set(items.map((item) => item.logical_engine)).size === items.length,
    'Provider engines must be unique',
  );
const credentials = {
  api_key: z.string().default(''),
  api_login: z.string().max(255).default(''),
  api_password: z.string().default(''),
};
export const createConnectionInput = z
  .object({
    label: z.string().max(255).default(''),
    transport_provider: transportProviderSchema,
    ...credentials,
    base_url: endpoint.default(''),
    active: z.boolean().default(true),
    routes: routes.default([]),
  })
  .superRefine((input, ctx) => {
    const pair = input.transport_provider === 'dataforseo';
    if (
      (pair && (input.api_key || !input.api_login.trim() || !input.api_password)) ||
      (!pair && (!input.api_key.trim() || input.api_login || input.api_password))
    )
      ctx.addIssue({ code: 'custom', message: 'Credentials must match the provider transport' });
  });
export const updateConnectionInput = z
  .object({
    label: z.string().max(255).nullish(),
    api_key: z.string().nullish(),
    api_login: z.string().max(255).nullish(),
    api_password: z.string().nullish(),
    base_url: endpoint.nullish(),
    active: z.boolean().nullish(),
    routes: routes.nullish(),
    confirm_destination_change: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    const login = input.api_login?.trim() || '';
    const password = input.api_password || '';
    if (Boolean(login) !== Boolean(password) || (input.api_key?.trim() && (login || password)))
      ctx.addIssue({ code: 'custom', message: 'Supply a key or both credential halves' });
  });
export type ConnectionCreate = z.output<typeof createConnectionInput>;
export type ConnectionUpdate = z.output<typeof updateConnectionInput>;
