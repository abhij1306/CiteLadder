/**
 * Request bodies of the BYOK provider connections. The credential is
 * write-only: it is sent here and never present on a response. A credential is
 * either a bearer `api_key` or an HTTP Basic `api_login` + `api_password`
 * pair; the API refines each body so the shape matches the transport and a
 * half pair is refused at the edge. The browser types its arguments as
 * `z.input` of these.
 */
import { z } from 'zod';

import { logicalEngineSchema, transportProviderSchema } from './providers.ts';

/** An endpoint override: https, or http on loopback only; no credentials, query or fragment. */
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

/** The engines a connection serves; each engine at most once. */
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

/** A partial connection edit; an absent or null field is kept. */
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
