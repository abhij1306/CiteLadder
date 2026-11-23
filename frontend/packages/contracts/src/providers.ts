import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.strictObject(shape);
const uuid = () => z.uuid();

export const transportProviderSchema = z.enum(['openai', 'anthropic', 'google', 'dataforseo']);
export const logicalEngineSchema = z.enum([
  'chatgpt',
  'gemini',
  'claude',
  'google_ai_overview',
  'google_ai_mode',
  'chatgpt_search',
  'gemini_consumer',
]);
export const surfaceKindSchema = z.enum(['llm', 'search_ai', 'llm_scraper']);

const providerRouteSchema = responseObject({
  id: uuid(),
  logical_engine: logicalEngineSchema,
  transport_provider: transportProviderSchema,
  transport_model: z.string(),
  is_default: z.boolean(),
  active: z.boolean().optional(),
});

export const providerConnectionSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  // Optional so the minimal shape (used in the schema test) still
  // validates; the live DTO always sends these.
  label: z.string().nullable().optional(),
  transport_provider: transportProviderSchema,
  base_url: z.string().nullable(),
  active: z.boolean(),
  api_key_set: z.boolean().optional(),
  last_tested_at: z.string().nullable().optional(),
  last_test_status: z.string().optional(),
  routes: z.array(providerRouteSchema).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const providerCatalogRouteSchema = responseObject({
  transport_provider: transportProviderSchema,
  transport_model: z.string(),
  retrieval_enabled: z.boolean().nullable().default(null),
  reasoning_effort: z.string().nullable().default(null),
  surface_kind: surfaceKindSchema,
});

const providerCatalogEngineSchema = responseObject({
  logical_engine: logicalEngineSchema,
  label: z.string().min(1),
  routes: z.array(providerCatalogRouteSchema),
});

export const providerCatalogSchema = responseObject({
  transports: z.array(transportProviderSchema),
  engines: z.array(providerCatalogEngineSchema),
});

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
export type TransportProvider = z.infer<typeof transportProviderSchema>;
export type LogicalEngine = z.infer<typeof logicalEngineSchema>;
export type SurfaceKind = z.infer<typeof surfaceKindSchema>;
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export type ProviderCatalog = z.infer<typeof providerCatalogSchema>;
export type ProviderConnectionState = z.infer<typeof providerConnectionStateSchema>;
export type ProviderConnectionStateEntry = z.infer<typeof providerConnectionStateEntrySchema>;
