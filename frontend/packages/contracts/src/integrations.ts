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

// Grant lifecycle (`IntegrationOAuthGrant.status`). `pending_revocation` is
// disconnect-requested with the remote revoke not yet confirmed (encrypted
// tokens deliberately retained); `revoked` is fully torn down.
const integrationGrantStatusSchema = z.enum([
  'connected',
  'needs_reauth',
  'pending_revocation',
  'revoked',
  'error',
]);

// Why a sync run was enqueued (`IntegrationSyncRun.sync_kind`).
const integrationSyncKindSchema = z.enum(['scheduled', 'on_demand', 'backfill']);

// `IntegrationSyncRun` IS a queue row (same shared queue-row contract as
// `AuditTask` / `SiteCrawlTask` / `AgentRun`), so the wire statuses
// are the queue statuses — the same vocabulary as `siteCrawlTaskStatusSchema`.
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

// The list endpoint returns a bare array of connections (never wrapped).
export const integrationConnectionListSchema = z.array(integrationConnectionSchema);

// `POST /integrations/{id}/test` — cheap authenticated probe result (status +
// error_code, never the token). `error_code` is '' on success.
export const integrationTestResultSchema = responseObject({
  connection_id: uuid(),
  status: z.string(),
  error_code: z.string(),
  detail: z.string(),
  tested_at: z.string(),
});

// Sync-run history/detail projection (status, window, row counts — invariant
// 7: a read-only projection of the queue row). `row_count` is the number of
// imported rows; `error_code` / `error_detail` are '' when there is no error.
// `processing` is true while the project's post-sync projection tasks are
// still queued or running, so the pages do not yet show this import.
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

// `GET /integrations/{id}/syncs/progress` — the history-import rollup behind
// the connection card. A projection over the connection's backfill runs, so
// `state` keeps the cases apart that a count alone would blur: `not_started`
// (no import was ever enqueued) is not zero imported windows, and `partial`
// (all terminal, some failed) is not `complete`. `covered_from`/`_through`
// bound the SUCCEEDED windows only and are null until one succeeds.
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

// `POST /integrations/{id}/properties` — the provider properties this grant can
// read, for the property picker. Discovery output, not stored state:
// `property_ref` is the canonical ref posted back to create a mapping
// (a GSC siteUrl, a bare GA4 numeric id); `label` is display-only.
export const integrationPropertySchema = responseObject({
  property_ref: z.string(),
  label: z.string(),
  // Whether the property belongs to the project named in the discovery request;
  // null when no project was named or the provider exposes no site (GA4).
  matches_project: z.boolean().nullable(),
});

export const integrationPropertyListSchema = z.array(integrationPropertySchema);

// `GET|POST /integrations/{id}/mappings` — the property→project bridge that
// tells a sync WHICH property to pull and which project owns the rows.
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

// 202 enqueue identity (C3) — one per queued run. The frontend polls
// `GET /integrations/{connection_id}/syncs/{sync_run_id}` until terminal.
export const integrationSyncEnqueueSchema = responseObject({
  sync_run_id: uuid(),
  connection_id: uuid(),
  status: integrationSyncRunStatusSchema,
});

// `POST /projects/{id}/traffic/sync` fans out to every active mapped GSC/GA4
// connection of the project, so the 202 carries one C3 enqueue object per
// queued run — a bare array ("{sync_run_id, connection_id, status} per run").
export const performanceSyncEnqueueResponseSchema = z.array(integrationSyncEnqueueSchema);
