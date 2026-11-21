import { z } from 'zod';

import { logicalEngineSchema, transportProviderSchema } from './providers.ts';

const endpoint = () =>
  z
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
            (url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        );
      } catch {
        return false;
      }
    }, 'Provider endpoint is invalid');

const routes = () =>
  z
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

export const providerConnectionCreateRequestSchema = z.object({
  label: z.string().max(255).default(''),
  transport_provider: transportProviderSchema,
  api_key: z.string().default(''),
  api_login: z.string().max(255).default(''),
  api_password: z.string().default(''),
  base_url: endpoint().default(''),
  active: z.boolean().default(true),
  routes: routes().default([]),
});
export type ProviderConnectionCreateRequest = z.input<typeof providerConnectionCreateRequestSchema>;

export const providerConnectionUpdateRequestSchema = z.object({
  label: z.string().max(255).nullish(),
  api_key: z.string().nullish(),
  api_login: z.string().max(255).nullish(),
  api_password: z.string().nullish(),
  base_url: endpoint().nullish(),
  active: z.boolean().nullish(),
  routes: routes().nullish(),
  confirm_destination_change: z.boolean().default(false),
});
export type ProviderConnectionUpdateRequest = z.input<typeof providerConnectionUpdateRequestSchema>;
