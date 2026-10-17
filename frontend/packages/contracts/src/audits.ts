import { z } from 'zod';
import { benchmarkModeSchema } from './project.ts';
import { logicalEngineSchema, transportProviderSchema } from './providers.ts';
import { auditMarketSchema } from './markets.ts';
import { executionAdsSchema } from './visibility-ads.ts';
import { executionClaimSchema } from './fact-checking.ts';
import { executionPerceptionSchema } from './visibility-perception.ts';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Audits (runs) + executions + evidence
// ---------------------------------------------------------------------------

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

/**
 * One measured route on an AGGREGATE surface. Aggregates carry a LIST of these
 * in stable catalog order and must never be collapsed into a single model:
 * `retrieval_enabled: null` means the audit predates the frozen policy, not
 * "retrieval off".
 */
export const modelProvenanceSchema = responseObject({
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  retrieval_enabled: z.boolean().nullable(),
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
  benchmark_mode: z.string(),
  audit_scope: z.enum(['brand', 'commerce']).default('brand'),
  model_provenance: z.array(modelProvenanceSchema).default([]),
  repetitions: z.number().int(),
  random_seed: z.string(),
  requested_count: z.number().int(),
  completed_count: z.number().int(),
  failed_count: z.number().int(),
  error_message: z.string(),
  engine_snapshots: z.array(auditEngineSnapshotSchema),
  /** The market this run measured from; one launch shares a `launch_id`. */
  market: auditMarketSchema,
  launch_id: uuid().nullable(),
  /** Requested engines that cannot measure this market, so never ran. */
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
  audit_scope: z.enum(['brand', 'commerce']),
  cadence: auditScheduleCadenceSchema,
  interval_minutes: z.number().int().nullable(),
  timezone: z.string(),
  engines: z.array(logicalEngineSchema),
  /** Each occurrence launches one audit per market; `null` is the project default. */
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
  /** The selected markets this engine can measure. */
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
  // Who owns the PLATFORM ('external' | 'google_owned'), independent of
  // source_class. A YouTube citation is google_owned AND video: the platform
  // being Google's says nothing about whether the channel is worth pursuing.
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
  // Observed search surfaces wait on a task running at the PROVIDER, not
  // here. Both are common mid-run and, per the note above, a status missing
  // from this list fails the whole executions list rather than one row.
  'awaiting_provider_result',
  'submission_uncertain',
  'failed',
  'cancelled',
]);

// One execution/queue row in the run's executions table (`AuditTaskResponse`).
// `answer_text` / `error_detail` default to '' (never null); the classified
// citation evidence lives on the single-execution evidence endpoint below.
export const executionSchema = responseObject({
  id: uuid(),
  audit_id: uuid(),
  prompt_index: z.number().int(),
  repetition: z.number().int(),
  randomized_position: z.number().int(),
  logical_engine: z.string(),
  transport_provider: z.string(),
  transport_model: z.string(),
  // Execution surface: the provenance triple is SINGULAR (one execution = one
  // exact model), projected from the frozen task snapshots only.
  retrieval_enabled: z.boolean().nullable().default(null),
  // The persisted search-surface outcome; '' for an LLM execution. Absence
  // must be read from this and never inferred from an empty answer, because
  // an AI Overview that was present but carried no extractable text looks
  // identical from the outside.
  search_surface_outcome: z.string().default(''),
  status: executionStatusSchema,
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  prompt_text: z.string(),
  answer_text: z.string(),
  search_used: z.boolean(),
  error_code: z.string(),
  error_detail: z.string(),
  latency_ms: z.number().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

/**
 * One inline link the AI Overview pointed at from inside its own text
 * (`AioLinkEvidence`). Inline links only — never the block's references, which
 * arrive as citations. Keeping them apart is what lets the evidence view show
 * "linked but not cited" as the distinct fact it is.
 */
const aioLinkSchema = responseObject({
  url: z.string(),
  domain: z.string(),
  title: z.string(),
  element_index: z.number().int(),
});

/**
 * One tracked entity's presence in an AI Overview (`SurfaceEntityEvidence`).
 *
 * `mentioned`, `linked` and `cited` come from three independent sources and
 * are never derived from one another. `mention_order` is computed server-side
 * from persisted offsets and is null for an entity the answer never named —
 * which is not last place.
 */
export const surfaceEntitySchema = responseObject({
  name: z.string(),
  kind: z.enum(['brand', 'competitor']),
  mentioned: z.boolean(),
  linked: z.boolean(),
  cited: z.boolean(),
  first_offset: z.number().int().nullable(),
  mention_order: z.number().int().nullable(),
});

/**
 * What one observed-surface execution saw (`SearchSurfaceEvidence`).
 *
 * `aio_present` keeps three states: true shown, false observed absence, null
 * we never successfully looked. It must never be coerced to a boolean.
 */
export const searchSurfaceEvidenceSchema = responseObject({
  outcome: z.string(),
  aio_present: z.boolean().nullable(),
  // The overview BLOCK's position on the SERP. Never a brand rank.
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

/**
 * One published rate with the denominator it divided by (`AioRateValue`).
 *
 * `value` is null for UNAVAILABLE and is never 0. Rendering an empty
 * denominator as 0% would be a measurement claim nobody made.
 */
export const aioRateSchema = responseObject({
  numerator: z.number().int(),
  denominator: z.number().int(),
  denominator_kind: z.string(),
  value: z.number().nullable(),
});

const aioCompetitorRateSchema = responseObject({
  name: z.string(),
  rate: aioRateSchema,
});

/**
 * The five AI Overview rates for one measurement selection
 * (`SurfaceRatesResponse`). `excluded` counts observations that entered no
 * denominator — failures on our side, reported rather than hidden.
 */
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
  // Execution-level surface: singular model, frozen snapshots only.
  retrieval_enabled: z.boolean().nullable().default(null),
  prompt_index: z.number().int(),
  repetition: z.number().int(),
  prompt_class: z.string(),
  cohort: z.string(),
  brand_mentioned: z.boolean(),
  brand_first_offset: z.number().int().nullable(),
  owned_domain_cited: z.boolean(),
  owned_citation_count: z.number().int(),
  unintended_domain_cited: z.boolean(),
  citation_count: z.number().int(),
  search_used: z.boolean(),
  search_query_count: z.number().int(),
  avg_position: z.number().nullable(),
  score: z.record(z.string(), z.unknown()).nullable(),
  citations: z.array(citationSchema),
  competitors_mentioned: z.array(z.string()),
  // Null for an LLM execution, and null for a search execution that
  // produced no observation — a gap in ours, not a measured absence.
  search_surface: searchSurfaceEvidenceSchema.nullable().default(null),
  // Per named business: its answer perception label and verified quotes.
  perception: z.array(executionPerceptionSchema),
  // The brand's factual claims and their verdicts; empty outside the fact-checking pilot.
  claims: z.array(executionClaimSchema),
  // Paid placements shown with the answer; never part of its citations.
  ads: executionAdsSchema,
  created_at: z.string(),
});
