import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.strictObject(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Providers (BYOK) — secret never present
// ---------------------------------------------------------------------------

// The complete BYOK transport surface exposed by the provider catalog.
export const transportProviderSchema = z.enum(['openai', 'anthropic', 'google', 'dataforseo']);
// Every engine the analysis side understands. `google_ai_overview` is an
// OBSERVED search surface rather than a conversational engine, and it is a
// member here before it is selectable in a run — a connection may be
// configured for a surface whose execution path has not shipped.
export const logicalEngineSchema = z.enum([
  'chatgpt',
  'gemini',
  'claude',
  'google_ai_overview',
  'chatgpt_search',
  'gemini_consumer',
]);
// How a surface is reached, and therefore which request shape it has. An
// `llm` route is asked a question; a `search_ai` route is observed.
export const surfaceKindSchema = z.enum(['llm', 'search_ai', 'llm_scraper']);

// A configured route on a connection: which logical engine this transport
// serves and the concrete transport model to call.
const providerRouteSchema = responseObject({
  id: uuid(),
  logical_engine: logicalEngineSchema,
  transport_provider: transportProviderSchema,
  transport_model: z.string(),
  is_default: z.boolean(),
  // Backend defaults to true.
  active: z.boolean().optional(),
});

// Strict: an unexpected key (e.g. a leaked `api_key`/`secret`) is a contract
// violation and must fail loud — the secret is never present on the wire.
export const providerConnectionSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  // Optional so the minimal shape (used in the schema test) still
  // validates; the live DTO always sends these.
  label: z.string().nullable().optional(),
  transport_provider: transportProviderSchema,
  base_url: z.string().nullable(),
  active: z.boolean(),
  // Presence flag only — the key value itself is NEVER on the wire.
  api_key_set: z.boolean().optional(),
  last_tested_at: z.string().nullable().optional(),
  // Backend defaults to '' (untested); accept any short status string.
  last_test_status: z.string().optional(),
  routes: z.array(providerRouteSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

// `retrieval_enabled` and `reasoning_effort` describe how an LLM is ASKED and
// are null on an observed search surface. Read `surface_kind` to know which
// shape a route is, rather than inferring it from a missing field.
const providerCatalogRouteSchema = responseObject({
  transport_provider: transportProviderSchema,
  transport_model: z.string(),
  retrieval_enabled: z.boolean().nullable().default(null),
  reasoning_effort: z.string().nullable().default(null),
  surface_kind: surfaceKindSchema,
});

const providerCatalogEngineSchema = responseObject({
  logical_engine: logicalEngineSchema,
  routes: z.array(providerCatalogRouteSchema),
});

export const providerCatalogSchema = responseObject({
  transports: z.array(transportProviderSchema),
  engines: z.array(providerCatalogEngineSchema),
});

// `POST /provider-connections/{id}/test`. Lives here with every other response
// contract rather than beside the caller, and locks `status` to the two values
// the backend actually emits so a probe outcome cannot be a free string.
export const connectionTestResultSchema = responseObject({
  connection_id: uuid(),
  status: z.enum(['ok', 'failed']),
  error_code: z.string().default(''),
  detail: z.string().default(''),
  latency_ms: z.number().nullable().default(null),
  logical_engine: z.string().default(''),
  transport_provider: z.string().default(''),
  transport_model: z.string().default(''),
  tested_at: z.string(),
});

// --- Authenticated provider connection state -------------------------------
// What this workspace's provider connections actually are.
export const providerConnectionStateSchema = z.enum([
  'connected',
  'missing',
  'failed',
  'unavailable',
]);

const providerProbeSchema = z.object({
  status: z.enum(['ok', 'failed']),
  safe_reason: z.string().nullable(),
  tested_at: z.string(),
  model: z.string().nullable(),
  latency_ms: z.number().int().nullable(),
});

export const providerConnectionStateEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  state: providerConnectionStateSchema,
  safe_reason: z.string().nullable(),
  grant_key: z.string(),
  latest_probe: providerProbeSchema.nullable(),
});

export const providerConnectionStatesSchema = z.object({
  workspace_id: z.uuid(),
  providers: z.array(providerConnectionStateEntrySchema),
});
