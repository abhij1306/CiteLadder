import { z } from 'zod';
import { brandMarkFields } from './brand-mark.ts';
import { benchmarkModeSchema } from './project.ts';
import { logicalEngineSchema, transportProviderSchema } from './providers.ts';
import { auditMarketSchema } from './markets.ts';
import { executionAdsSchema } from './visibility-ads.ts';
import { executionClaimSchema } from './fact-checking.ts';
import { executionPerceptionSchema } from './visibility-perception.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

export const auditScopeSchema = z.enum(['brand', 'commerce', 'probe']);

export const auditStatusSchema = z.enum([
  'draft',
  'validating',
  'queued',
  'running',
  'analyzing',
  'reporting',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
]);

// The engine provenance a run froze at launch (`AuditEngineSnapshotResponse`).
const auditEngineSnapshotSchema = responseObject({
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
});

export const modelProvenanceSchema = responseObject({
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  retrieval_enabled: z.boolean(),
});

// A run/audit projection (`AuditResponse`). `random_seed` is a decimal
// STRING (64-bit seed), `error_message` a non-null string ('' when unset), and
// the engine provenance is carried but the provider key never is.
export const auditSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  project_id: uuid(),
  parent_audit_id: uuid().nullable().default(null),
  status: auditStatusSchema,
  cancelable: z.boolean(),
  benchmark_mode: z.string(),
  audit_scope: auditScopeSchema.default('brand'),
  model_provenance: z.array(modelProvenanceSchema).default([]),
  repetitions: z.number().int(),
  random_seed: z.string(),
  requested_count: z.number().int(),
  completed_count: z.number().int(),
  failed_count: z.number().int(),
  error_message: z.string(),
  engine_snapshots: z.array(auditEngineSnapshotSchema),
  market: auditMarketSchema,
  launch_id: uuid().nullable(),
  not_applicable_engines: z.array(logicalEngineSchema),
  created_at: z.string(),
  updated_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const auditScheduleCadenceSchema = z.enum([
  'one_time',
  'every_n_minutes',
  'hourly',
  'daily',
  'weekly',
]);

export const auditScheduleSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  project_id: uuid(),
  prompt_set_id: uuid(),
  audit_scope: auditScopeSchema,
  cadence: auditScheduleCadenceSchema,
  interval_minutes: z.number().int().nullable(),
  timezone: z.string(),
  engines: z.array(logicalEngineSchema),
  market_ids: z.array(uuid().nullable()),
  repetitions: z.number().int().nullable(),
  benchmark_mode: benchmarkModeSchema.nullable(),
  enabled: z.boolean(),
  next_run_at: z.string().nullable(),
  last_run_at: z.string().nullable(),
  failure_count: z.number().int(),
  last_error: z.string(),
  last_failure_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const auditEngineEstimateSchema = responseObject({
  logical_engine: logicalEngineSchema,
  transport_provider: transportProviderSchema,
  transport_model: z.string(),
  retrieval_enabled: z.boolean().nullable(),
  prompt_count: z.number().int(),
  repetition_count: z.number().int(),
  market_count: z.number().int(),
  execution_count: z.number().int(),
  maximum_attempt_count: z.number().int(),
  estimated_input_tokens: z.number().int().nullable(),
  estimated_output_tokens: z.number().int().nullable(),
  estimated_search_calls: z.number().int().nullable(),
  estimated_token_cost_microusd: z.number().int().nullable(),
  estimated_search_cost_microusd: z.number().int().nullable(),
  estimated_total_cost_microusd: z.number().int().nullable(),
  cost_status: z.enum(['complete', 'partial', 'unknown']),
  pricing_version: z.string(),
});

export const auditEstimateSchema = responseObject({
  retrieval_enabled: z.boolean(),
  prompt_count: z.number().int(),
  engine_count: z.number().int(),
  repetition_count: z.number().int(),
  market_count: z.number().int(),
  execution_count: z.number().int(),
  maximum_attempt_count: z.number().int(),
  maximum_wall_clock_seconds: z.number().int(),
  cost_status: z.enum(['complete', 'partial', 'unknown']),
  estimated_total_cost_microusd: z.number().int().nullable(),
  engines: z.array(auditEngineEstimateSchema),
});

export const auditPerformanceSchema = responseObject({
  audit_id: uuid(),
  queue_wait_ms: z.number().int().nullable(),
  total_run_duration_ms: z.number().int().nullable(),
  time_to_first_result_ms: z.number().int().nullable(),
  execution_count: z.number().int(),
  completed_count: z.number().int(),
  failed_count: z.number().int(),
  coverage: z.number(),
  retry_count: z.number().int(),
  search_calls: z.number().int(),
  usage: responseObject({
    input_tokens: z.number().int().nullable(),
    output_tokens: z.number().int().nullable(),
    total_tokens: z.number().int().nullable(),
  }),
  projected_cost_microusd: z.number().int().nullable(),
  engines: z.array(
    responseObject({
      logical_engine: z.string(),
      execution_count: z.number().int(),
      completed_count: z.number().int(),
      failed_count: z.number().int(),
      retry_count: z.number().int(),
      search_calls: z.number().int(),
      average_provider_latency_ms: z.number().nullable(),
      projected_cost_microusd: z.number().int().nullable(),
    }),
  ),
});
export const auditMetricsSchema = responseObject({
  audit_id: uuid(),
  project_id: uuid(),
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  total_completed: z.number().int(),
  total_failed: z.number().int(),
  visibility_score: z.number(),
  metrics: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

// Deterministic citation classification (`_classification`):
// owned / unintended (owned-but-unwanted) / competitor / third-party.
export const citationClassificationSchema = z.enum([
  'owned',
  'unintended',
  'competitor',
  'third_party',
]);

// One classified source citation on the evidence card (`CitationEvidence`).
export const citationSchema = responseObject({
  ordinal: z.number().int(),
  url: z.string(),
  title: z.string(),
  domain: z.string(),
  classification: citationClassificationSchema,
  source_class: z.string().nullable().optional(),
  source_origin: z.string().optional(),
  source_taxonomy_version: z.string().nullable().optional(),
  is_owned: z.boolean(),
  is_unintended: z.boolean(),
  matched_competitor: z.string().nullable(),
});

// Queue/execution row status. This must list EVERY status the queue can
// persist, not just the ones a run usually ends on: the response is strictly
// validated, so a single row in a missing status fails the whole executions
// list. `capacity_wait` (parked on a full provider pool) and
// `pending_reservation` (a task row before its provider route is bound, inside
// the creating transaction) are transient.
export const executionStatusSchema = z.enum([
  'pending_reservation',
  'queued',
  'leased',
  'running',
  'succeeded',
  'retry_wait',
  'capacity_wait',
  'awaiting_provider_result',
  'submission_uncertain',
  'failed',
  'cancelled',
]);

export const executionSchema = responseObject({
  id: uuid(),
  prompt_index: z.number().int(),
  logical_engine: z.string(),
  transport_provider: z.string(),
  status: executionStatusSchema,
  prompt_text: z.string(),
  error_code: z.string(),
  latency_ms: z.number().nullable(),
});

const aioLinkSchema = responseObject({
  url: z.string(),
  domain: z.string(),
  title: z.string(),
  element_index: z.number().int(),
});

export const surfaceEntitySchema = responseObject({
  name: z.string(),
  kind: z.enum(['brand', 'competitor']),
  ...brandMarkFields,
  mentioned: z.boolean(),
  linked: z.boolean(),
  cited: z.boolean(),
  first_offset: z.number().int().nullable(),
  mention_order: z.number().int().nullable(),
});

export const searchSurfaceEvidenceSchema = responseObject({
  outcome: z.string(),
  aio_present: z.boolean().nullable(),
  aio_serp_position: z.number().int().nullable(),
  provider_status_code: z.number().int().nullable(),
  error_code: z.string(),
  element_count: z.number().int(),
  reference_count: z.number().int(),
  location_code: z.number().int(),
  language_code: z.string(),
  device: z.string(),
  observed_at: z.string().nullable(),
  retrieved_at: z.string().nullable(),
  links: z.array(aioLinkSchema),
  entities: z.array(surfaceEntitySchema),
});

export const aioRateSchema = responseObject({
  numerator: z.number().int(),
  denominator: z.number().int(),
  denominator_kind: z.string(),
  value: z.number().nullable(),
});

const aioCompetitorRateSchema = responseObject({
  name: z.string(),
  ...brandMarkFields,
  rate: aioRateSchema,
});

export const surfaceRatesSchema = responseObject({
  logical_engine: z.string(),
  successful: z.number().int(),
  with_overview: z.number().int(),
  excluded: z.number().int(),
  trigger_rate: aioRateSchema,
  brand_mention_rate_when_present: aioRateSchema,
  overall_brand_visibility: aioRateSchema,
  owned_citation_rate_when_present: aioRateSchema,
  competitor_mention_rates: z.array(aioCompetitorRateSchema),
});

export const firstNamedSchema = z.discriminatedUnion('kind', [
  responseObject({ kind: z.literal('brand'), name: z.string() }),
  responseObject({ kind: z.literal('competitor'), name: z.string() }),
  responseObject({ kind: z.literal('none') }),
]);
export type FirstNamed = z.infer<typeof firstNamedSchema>;

export const markedFirstNamedSchema = z.discriminatedUnion('kind', [
  responseObject({ kind: z.literal('brand'), name: z.string(), ...brandMarkFields }),
  responseObject({ kind: z.literal('competitor'), name: z.string(), ...brandMarkFields }),
  responseObject({ kind: z.literal('none') }),
]);

export const answerFormatSchema = z.enum(['shopping', 'map', 'comparison', 'image']);
export const answerFormatsSchema = z.discriminatedUnion('kind', [
  responseObject({
    kind: z.literal('observed'),
    formats: z.array(answerFormatSchema),
    in_text_links: z.number().int().nonnegative(),
  }),
  responseObject({ kind: z.literal('unavailable') }),
  responseObject({ kind: z.literal('not_applicable') }),
]);
export type AnswerFormat = z.infer<typeof answerFormatSchema>;
export type AnswerFormats = z.infer<typeof answerFormatsSchema>;

export const promptAnswerSearchSchema = z.enum(['used', 'not_used', 'not_reported']);

const executionNamedSchema = responseObject({
  name: z.string(),
  kind: z.enum(['brand', 'competitor']),
  offset: z.number().int().nullable(),
  position: z.number().int().nullable(),
});

// One execution's persisted analysis + evidence (`ExecutionEvidenceResponse`,
// `GET /executions/{id}`). `id`/`task_id` are the EXECUTION (AuditTask) id — the
// same id space as the executions list — so the evidence page keys off the row
// id. `analysis_id` is the internal ResponseAnalysis id (traceability only).
export const executionEvidenceSchema = responseObject({
  id: uuid(),
  analysis_id: uuid(),
  audit_id: uuid(),
  task_id: uuid(),
  artifact_id: uuid().nullable(),
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  retrieval_enabled: z.boolean(),
  prompt_index: z.number().int(),
  repetition: z.number().int(),
  prompt_class: z.string(),
  cohort: z.string(),
  answer_text: z.string(),
  search_surface_outcome: z.string(),
  brand_mentioned: z.boolean(),
  brand_first_offset: z.number().int().nullable(),
  owned_domain_cited: z.boolean(),
  owned_citation_count: z.number().int(),
  unintended_domain_cited: z.boolean(),
  citation_count: z.number().int(),
  search_used: z.boolean(),
  search: promptAnswerSearchSchema,
  search_query_count: z.number().int(),
  avg_position: z.number().nullable(),
  first_named: markedFirstNamedSchema,
  named: z.array(executionNamedSchema),
  answer_formats: answerFormatsSchema,
  score: z.record(z.string(), z.unknown()).nullable(),
  citations: z.array(citationSchema),
  competitors_mentioned: z.array(z.string()),
  search_surface: searchSurfaceEvidenceSchema.nullable().default(null),
  perception: z.array(executionPerceptionSchema),
  claims: z.array(executionClaimSchema),
  ads: executionAdsSchema,
  created_at: z.string(),
});

export type ModelProvenance = z.infer<typeof modelProvenanceSchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type AuditScheduleCadence = z.infer<typeof auditScheduleCadenceSchema>;
export type AuditSchedule = z.infer<typeof auditScheduleSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type CitationClassification = z.infer<typeof citationClassificationSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type ExecutionEvidence = z.infer<typeof executionEvidenceSchema>;
export type PromptAnswerSearch = z.infer<typeof promptAnswerSearchSchema>;
export type SearchSurfaceEvidence = z.infer<typeof searchSurfaceEvidenceSchema>;
export type SurfaceEntity = z.infer<typeof surfaceEntitySchema>;
export type AioRate = z.infer<typeof aioRateSchema>;
export type SurfaceRates = z.infer<typeof surfaceRatesSchema>;
