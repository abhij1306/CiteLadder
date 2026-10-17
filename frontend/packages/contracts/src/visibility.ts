import { z } from 'zod';
import { actionStatusSchema } from './actions.ts';
import { auditStatusSchema, modelProvenanceSchema } from './audits.ts';
import { projectMarketSchema } from './markets.ts';
import { buyerTypeSchema, marketScopeSchema, promptCohortSchema } from './project.ts';

/** What a Visibility read counts: one prompt cohort, or `all` prompts together. */
export const visibilityCohortSchema = z.enum([...promptCohortSchema.options, 'all']);

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

export const measurementCountsSchema = responseObject({
  state: z.string(),
  responses: z.number().int(),
  brand_responses: z.number().int().nullable(),
  owned_citation_responses: z.number().int().nullable(),
  entity_presences: z.number().int().nullable(),
  expected: z.number().int().nullable(),
  failed: z.number().int().nullable(),
  not_run: z.number().int().nullable(),
});

// ---------------------------------------------------------------------------
// Visibility dashboard (selected-run projection)
// ---------------------------------------------------------------------------

// One per-engine comparison row for the selected run (`EngineComparisonRow`).
export const visibilityEngineSchema = responseObject({
  logical_engine: z.string(),
  total_completed: z.number().int(),
  brand_mention_rate: z.number().nullable(),
  owned_citation_rate: z.number().nullable(),
  search_use_rate: z.number().nullable(),
  visibility_score: z.number().nullable(),
  counts: measurementCountsSchema.optional(),
});

// One brand-vs-competitor rankings-table row (`RankingRow`). `website_url`
// lets BrandLogo use its Logo.dev fallback when the cached `logo_url` is absent.
// `mention_rate` is the Visibility% and `share_of_voice` the SOV%.
// `avg_position` is the entity's mean rank among the brands named in an answer,
// derived from mention offsets. Tone is the Perception read, never a ranking column.
export const rankingRowSchema = responseObject({
  name: z.string(),
  is_brand: z.boolean(),
  logo_url: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  mention_rate: z.number().nullable(),
  citation_rate: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  mention_count: z.number().int(),
  visibility_delta: z.number().nullable().optional(),
  gap_count: z.number().int().nullable().optional(),
  matched_visibility_rate: z.number().nullable().optional(),
  matched_visibility_delta: z.number().nullable().optional(),
  matched_response_count: z.number().int().nullable().optional(),
  avg_position: z.number().nullable(),
});

// Selected-run dashboard projection (`VisibilityResponse`). Computed
// server-side from the persisted MetricSnapshot for the selected audit
// (defaults to the latest completed audit). No cross-run trend in this payload
// — the Trends tab reads /visibility/trends for that.
export const visibilityComparisonSchema = responseObject({
  status: z.string(),
  baseline_audit_id: uuid().nullable(),
  baseline_audit_ids: z.array(uuid()),
  baseline_at: z.string().nullable(),
  baseline_counts: measurementCountsSchema.nullable(),
  current_counts: measurementCountsSchema.nullable(),
  deltas: z.record(z.string(), z.number().nullable()),
  rankings: z.array(rankingRowSchema),
  skipped_runs: z.number().int(),
  matched_cells: z.number().int(),
  current_cells: z.number().int(),
  baseline_cells: z.number().int(),
  current_values: z.record(z.string(), z.number().nullable()),
  baseline_values: z.record(z.string(), z.number().nullable()),
  current_rankings: z.array(rankingRowSchema),
});

export const visibilitySchema = responseObject({
  project_id: uuid(),
  audit_id: uuid(),
  audit_status: auditStatusSchema,
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  cohort: visibilityCohortSchema.default('core'),
  coverage: z.record(z.string(), z.number().nullable()).default({}),
  total_completed: z.number().int(),
  total_failed: z.number().int(),
  visibility_score: z.number().nullable(),
  visibility_rate: z.number().nullable().optional(),
  owned_citation_rate: z.number().nullable().optional(),
  prompt_performance_score: z.number().nullable().optional(),
  counts: measurementCountsSchema.optional(),
  comparison_key: z.string().nullable().optional(),
  comparison: visibilityComparisonSchema.optional(),
  // Citations counted as citations. `owned_citation_rate` above counts ANSWERS
  // that contained one, which is a different measure with a different
  // denominator — both are true and they are never interchangeable.
  citation_totals: z
    .object({
      citations: z.number().int(),
      owned_citations: z.number().int(),
      owned_share: z.number().nullable(),
    })
    .optional(),
  // The backend answers with how the run was RESOLVED, not what was asked for:
  // an omitted `audit_id` resolves to "latest". Accepting only run|range made
  // the default landing request fail validation, which surfaced as
  // "Could not load the selected measurement" on a perfectly good 200.
  selection_mode: z.enum(['latest', 'run', 'range']).optional(),
  source_audit_ids: z.array(uuid()).optional(),
  configuration_groups: z.record(z.string(), z.number().int()).optional(),
  from_at: z.string().nullable().optional(),
  to_at: z.string().nullable().optional(),
  // Aggregate surface: never a forced singular model across engines.
  model_provenance: z.array(modelProvenanceSchema).default([]),
  rankings: z.array(rankingRowSchema),
  per_engine: z.array(visibilityEngineSchema),
  avg_position: z.number().nullable(),
  created_at: z.string(),
});

// How a prompt's successful answers crossed brand mention with an owned
// citation, one answer counted once. Null when nothing was answered.
export const answerStatesSchema = responseObject({
  mentioned_and_cited: z.number().int(),
  mentioned_only: z.number().int(),
  cited_only: z.number().int(),
  neither: z.number().int(),
});
export type AnswerStates = z.infer<typeof answerStatesSchema>;

export const promptMetricItemSchema = responseObject({
  id: uuid(),
  audit_id: uuid(),
  prompt_id: uuid().nullable(),
  prompt_index: z.number().int(),
  prompt_text: z.string(),
  prompt_snapshot_id: uuid().nullable().optional(),
  cohort: z.string(),
  composite_score: z.number().nullable(),
  source_audit_ids: z.array(uuid()).optional(),
  previous_score: z.number().nullable(),
  immediate_delta: z.number().nullable(),
  rolling_four: z.array(z.number()),
  per_engine_scores: z.record(z.string(), z.number()),
  components: z.record(z.string(), z.number().nullable()),
  engine_agreement: z.number(),
  repetition_agreement: z.number(),
  evidence_coverage: z.number(),
  trend_confidence: z.number(),
  decline_confirmed: z.boolean(),
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  created_at: z.string(),
  theme: z.string().optional(),
  intent: z.string().optional(),
  visibility_rate: z.number().nullable().optional(),
  owned_citation_rate: z.number().nullable().optional(),
  // Mean rank among the brands named in this prompt's answers.
  avg_position: z.number().nullable().optional(),
  visibility_delta: z.number().nullable().optional(),
  comparison_status: z.string().optional(),
  comparison: visibilityComparisonSchema.nullable().optional(),
  counts: measurementCountsSchema.optional(),
  answer_states: answerStatesSchema.nullable().optional(),
  // The Action that targets this prompt, when the refresh opened one.
  action_id: uuid().nullable().optional(),
  outcomes: z
    .array(
      responseObject({
        logical_engine: z.string(),
        transport_model: z.string(),
        counts: measurementCountsSchema,
        visibility_rate: z.number().nullable(),
        owned_citation_rate: z.number().nullable(),
        answer_states: answerStatesSchema.nullable().optional(),
        // Competitors named in the answers that did not name the brand.
        gap_counts: z.record(z.string(), z.number().int()),
      }),
    )
    .optional(),
});

// One run that measured the prompt, oldest first. Rates are null when the run
// produced no successful answer for it: unavailable, never zero.
// `comparable_with_previous` is false when the frozen measurement context,
// prompt text or analyzer/scoring versions changed since the previous point,
// and null on the first point.
export const promptHistoryPointSchema = responseObject({
  audit_id: uuid(),
  completed_at: z.string(),
  prompt_text: z.string(),
  counts: measurementCountsSchema,
  mention_rate: z.number().nullable(),
  owned_citation_rate: z.number().nullable(),
  answer_states: answerStatesSchema.nullable(),
  // Provenance: the persisted answers these rates count.
  source_analysis_ids: z.array(uuid()),
  comparison_key: z.string().nullable(),
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  comparable_with_previous: z.boolean().nullable(),
  // Provenance: the persisted prompt score this point reads.
  source_snapshot_id: uuid(),
});

// An Action whose frozen declaration checks measure this prompt, at the time
// the user said the work went live. A marker, never an attribution.
export const promptHistoryImplementationSchema = responseObject({
  implementation_event_id: uuid(),
  action_id: uuid(),
  title: z.string(),
  status: actionStatusSchema,
  implemented_at: z.string(),
});

export const promptHistorySchema = responseObject({
  prompt: responseObject({
    id: uuid(),
    text: z.string(),
    topic_id: uuid().nullable(),
    status: z.string(),
  }),
  cohort: visibilityCohortSchema,
  market_id: uuid().nullable(),
  logical_engine: z.string().nullable(),
  points: z.array(promptHistoryPointSchema),
  implementations: z.array(promptHistoryImplementationSchema),
  // The newest run that measured the prompt, with per-engine outcomes.
  latest: promptMetricItemSchema.nullable(),
});

export const observedCompetitorSchema = responseObject({
  id: uuid(),
  audit_id: uuid(),
  name: z.string(),
  domain: z.string(),
  qualification_reason: z.string(),
  prompt_count: z.number().int(),
  engine_count: z.number().int(),
  market_relevant: z.boolean(),
  analyzer_version: z.string(),
  source_analysis_ids: z.array(z.string()),
  source_artifact_ids: z.array(z.string()),
  status: z.string(),
  created_at: z.string(),
});

const discoveryProfileSchema = responseObject({
  description: z.string(),
  positioning: z.string(),
  products_services: z.array(z.string()),
  target_audience: z.string(),
  industry: z.string(),
  business_type: buyerTypeSchema.nullable(),
  price_tier: z.string(),
  field_confidence: z.record(z.string(), z.number()),
  // Resolved business context. `category` and `category_terms` are open
  // vocabulary and carry the specificity; the rest are closed facets that
  // decide which kinds of question get generated.
  category: z.string().default(''),
  category_options: z.array(z.string()).default([]),
  category_aliases: z.array(z.string()).default([]),
  category_terms: z.array(z.string()).default([]),
  jobs_to_be_done: z.array(z.string()).default([]),
  sector: z.string().nullable().default(null),
  business_model: z.string().nullable().default(null),
  secondary_business_models: z.array(z.string()).default([]),
  market_scope: marketScopeSchema.nullable().default(null),
  buyer_register: z.string().nullable().default(null),
  buyer_roles: z.array(z.string()).default([]),
  service_areas: z.array(z.string()).default([]),
  knowledge_strength: z.enum(['strong', 'weak', 'none']).default('none'),
});

const discoveryEvidenceSchema = responseObject({
  source_url: z.string(),
  capture_method: z.string(),
  confidence: z.number(),
  captured_at: z.string(),
  supports: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
  method: z.string(),
});

export const brandDiscoverySchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  project_id: uuid().nullable(),
  status: z.enum(['queued', 'running', 'failed', 'ready', 'project_created']),
  progress: responseObject({
    phase: z.enum([
      'opening_website',
      'understanding_business',
      'finding_competitors',
      'preparing_review',
      'complete',
    ]),
    completed_steps: z.number().int().nonnegative(),
    total_steps: z.number().int().positive(),
    pages_read: z.number().int().nonnegative(),
    competitors_found: z.number().int().nonnegative(),
  }),
  input_data: z.record(z.string(), z.unknown()),
  profile: discoveryProfileSchema,
  domains: z.array(z.string()),
  competitors: z.array(
    responseObject({
      name: z.string(),
      aliases: z.array(z.string()),
      domains: z.array(z.string()),
    }),
  ),
  evidence: z.array(discoveryEvidenceSchema),
  warnings: z.array(z.string()),
  error_code: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const brandDiscoveryCatalogSchema = responseObject({
  maximum_competitors: z.number().int().positive(),
  industries: z.array(z.string()),
  subindustries: z.record(z.string(), z.array(z.string())),
});

// Completion creates the project in the request, with an empty prompt set.
// A replay after the project was deleted reports no project.
export const brandDiscoveryCompleteSchema = responseObject({
  discovery_id: uuid(),
  project_id: uuid().nullable(),
  warnings: z.array(z.string()),
});

// Visibility → By market: each market's latest dashboard-ready run, measured
// apart. `no_run` is a market never measured, never a zero.
export const visibilityMarketRowSchema = responseObject({
  market: projectMarketSchema,
  state: z.enum(['measured', 'no_run']),
  audit_id: uuid().nullable(),
  measured_at: z.string().nullable(),
  mention_rate: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  net_sentiment: z.number().nullable(),
  // Movement in points against that market's previous comparable run.
  comparison_status: z.string().nullable(),
  mention_rate_delta: z.number().nullable(),
  share_of_voice_delta: z.number().nullable(),
});
export const visibilityMarketsSchema = responseObject({
  cohort: visibilityCohortSchema,
  markets: z.array(visibilityMarketRowSchema),
});
export type VisibilityMarkets = z.infer<typeof visibilityMarketsSchema>;
