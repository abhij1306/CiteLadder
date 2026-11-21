import { z } from 'zod';

const TOKEN_KEY = /(^|_)token($|_)/i;
const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.looseObject(shape).superRefine((value, context) => {
    for (const key of Object.keys(value)) {
      if (TOKEN_KEY.test(key)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Token fields are not permitted in integration responses',
        });
      }
    }
  });
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Integrations (GSC / GA4 / Bing), Traffic, and AI Referrals
//
// Additive fields are retained, but token-shaped keys are contract violations.
// ---------------------------------------------------------------------------

// Logical integration providers (the surfaces a workspace connects).
export const integrationProviderSchema = z.enum(['gsc', 'ga4', 'bing']);

const integrationGrantStatusSchema = z.enum([
  'connected',
  'needs_reauth',
  'pending_revocation',
  'revoked',
  'error',
]);

const integrationSyncKindSchema = z.enum(['scheduled', 'on_demand', 'backfill']);

const integrationSyncRunStatusSchema = z.enum([
  'queued',
  'leased',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled',
]);

// `GET /integrations` row: a connection joined to its grant's status +
// granted scopes. Tokens live encrypted on the grant and are NEVER serialized
// — any token-shaped key on the wire fails validation.
export const integrationConnectionSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  grant_id: uuid(),
  provider: integrationProviderSchema,
  label: z.string(),
  account_ref: z.string(),
  grant_status: integrationGrantStatusSchema,
  granted_scopes: z.array(z.string()),
  last_synced_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const integrationConnectionListSchema = z.array(integrationConnectionSchema);

export const integrationTestResultSchema = responseObject({
  connection_id: uuid(),
  status: z.string(),
  error_code: z.string(),
  detail: z.string(),
  tested_at: z.string(),
});

export const integrationSyncRunSchema = responseObject({
  id: uuid(),
  connection_id: uuid(),
  sync_kind: integrationSyncKindSchema,
  status: integrationSyncRunStatusSchema,
  window_start: z.string(),
  window_end: z.string(),
  row_count: z.number().int(),
  processing: z.boolean(),
  resync_seq: z.number().int(),
  error_code: z.string(),
  error_detail: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

const integrationBackfillStateSchema = z.enum(['not_started', 'importing', 'complete', 'partial']);

export const integrationBackfillProgressSchema = responseObject({
  connection_id: uuid(),
  state: integrationBackfillStateSchema,
  total_windows: z.number().int(),
  completed_windows: z.number().int(),
  failed_windows: z.number().int(),
  pending_windows: z.number().int(),
  covered_from: z.string().nullable(),
  covered_through: z.string().nullable(),
});

export const integrationPropertySchema = responseObject({
  property_ref: z.string(),
  label: z.string(),
  matches_project: z.boolean().nullable(),
});

export const integrationPropertyListSchema = z.array(integrationPropertySchema);

export const integrationPropertyMappingSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  connection_id: uuid(),
  provider: integrationProviderSchema,
  property_ref: z.string(),
  project_id: uuid(),
  status: z.enum(['active', 'disabled']),
  reporting_timezone: z.string().nullable().optional(),
  currency_code: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const integrationPropertyMappingListSchema = z.array(integrationPropertyMappingSchema);

export const integrationSyncEnqueueSchema = responseObject({
  sync_run_id: uuid(),
  connection_id: uuid(),
  status: integrationSyncRunStatusSchema,
});

export const performanceSyncEnqueueResponseSchema = z.array(integrationSyncEnqueueSchema);

export const integrationSyncRequestSchema = z.strictObject({
  project_id: uuid().optional(),
  window_start: z.iso.date().optional(),
  window_end: z.iso.date().optional(),
});
export type IntegrationSyncRequest = z.input<typeof integrationSyncRequestSchema>;

export const integrationPropertyDiscoveryRequestSchema = z.strictObject({
  project_id: uuid().optional(),
});
export type IntegrationPropertyDiscoveryRequest = z.input<
  typeof integrationPropertyDiscoveryRequestSchema
>;

export const integrationPropertyMappingRequestSchema = z.strictObject({
  provider: integrationProviderSchema,
  property_ref: z.string().min(1).max(512),
  project_id: uuid(),
});
export type IntegrationPropertyMappingRequest = z.input<
  typeof integrationPropertyMappingRequestSchema
>;
