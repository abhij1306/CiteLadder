import { z } from 'zod';
import { actionStatusSchema } from './actions.ts';
import { auditStatusSchema, modelProvenanceSchema } from './audits.ts';
import { projectMarketSchema } from './markets.ts';
import { buyerTypeSchema, marketScopeSchema, promptCohortSchema } from './project.ts';

export const visibilityCohortSchema = z.enum([...promptCohortSchema.options, 'all']);

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

const UNKNOWN = 'Null when the run did not record it: unknown, not zero.';
export const measurementCountsSchema = responseObject({
  state: z.string().describe('`measured`, or `no_observations` when no answer completed.'),
  responses: z.number().int().describe('Answers that completed.'),
  brand_responses: z.number().int().nullable().describe(`Answers that named the brand. ${UNKNOWN}`),
  owned_citation_responses: z
    .number()
    .int()
    .nullable()
    .describe(`Answers that cited the project's own site. ${UNKNOWN}`),
  entity_presences: z
    .number()
    .int()
    .nullable()
    .describe(`Brand and competitor namings, one per business per answer. ${UNKNOWN}`),
  expected: z.number().int().nullable().describe(`Answers the run asked for. ${UNKNOWN}`),
  failed: z.number().int().nullable().describe(`Answers that failed. ${UNKNOWN}`),
  not_run: z.number().int().nullable().describe(`Answers never attempted. ${UNKNOWN}`),
});

export const namedBrandSchema = responseObject({
  kind: z.enum(['brand', 'competitor']).describe('The tracked brand, or a roster competitor.'),
  name: z.string(),
  responses: z.number().int().describe('How many of these answers named it.'),
  logo_url: z.string().nullable(),
  website: z.string().nullable(),
});
export type NamedBrand = z.infer<typeof namedBrandSchema>;

export const citedDomainSchema = responseObject({
  domain: z.string(),
  citations: z.number().int().describe('Citations of this domain across these answers.'),
  owned: z.boolean().describe("Whether it is one of the project's own domains."),
});
export type CitedDomain = z.infer<typeof citedDomainSchema>;

export const winCountsSchema = responseObject({
  win_count: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Answers that named this business first among the tracked businesses.'),
  win_answers: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      'Answers that named at least one tracked business. Null: not measured; 0: not applicable.',
    ),
  win_rate: z
    .number()
    .nullable()
    .optional()
    .describe('`win_count` / `win_answers`, 0–1. Null when not measured or not applicable.'),
});
export type WinCounts = z.infer<typeof winCountsSchema>;

const RATE = 'Share of answers, 0–1; null when no answer completed.';
const MENTION_RATE = z.number().nullable().describe(`Answers that named the brand. ${RATE}`);
const OWNED_RATE = z
  .number()
  .nullable()
  .describe(`Answers that cited the project's own site. ${RATE}`);
const AVG_POSITION = z
  .number()
  .nullable()
  .describe('Mean rank among the businesses an answer named, 1 being first. Null: never named.');
const SCORE =
  'Visibility score, 0–100: the mean prompt score, weighting mention, own citation and competitive position.';

// One per-engine comparison row for the selected run (`EngineComparisonRow`).
export const visibilityEngineSchema = responseObject({
  logical_engine: z.string(),
  total_completed: z.number().int(),
  brand_mention_rate: MENTION_RATE,
  owned_citation_rate: OWNED_RATE,
  search_use_rate: z.number().nullable().describe(`Answers that searched the web. ${RATE}`),
  visibility_score: z.number().nullable().describe(SCORE),
  counts: measurementCountsSchema.optional(),
  ...winCountsSchema.shape,
});

export const netSentimentSchema = responseObject({
  mentions: z.number().int().describe('Answers that named the business.'),
  classified: z.number().int().describe('Of those, the ones whose tone was classified.'),
  positive: z.number().int(),
  negative: z.number().int(),
  net_sentiment: z
    .number()
    .nullable()
    .describe('(positive − negative) / classified × 100, −100 to 100. Null: nothing classified.'),
});

export const webSearchShareSchema = responseObject({
  searched: z.number().int().describe('Answers that searched the web.'),
  reported: z.number().int().describe('Answers whose engine reports whether it searched.'),
  share: z
    .number()
    .nullable()
    .describe('`searched` / `reported`, 0–1. Null: no engine reported it (not available, not 0%).'),
});

const DELTA =
  'Change in percentage points against the baseline run; null or absent when not comparable.';
// One brand-vs-competitor rankings-table row (`RankingRow`). `website_url`
// lets BrandLogo use its Logo.dev fallback when the cached `logo_url` is absent.
// `mention_rate` is the Visibility% and `share_of_voice` the SOV%.
// `avg_position` is the entity's mean rank among the brands named in an answer,
// derived from mention offsets. Tone is the Perception read, never a ranking column.
export const rankingRowSchema = responseObject({
  name: z.string(),
  is_brand: z.boolean().describe('The tracked brand, not a competitor.'),
  logo_url: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  mention_rate: z.number().nullable().describe(`Answers that named this business. ${RATE}`),
  citation_rate: z.number().nullable().describe(`Answers that cited its site. ${RATE}`),
  share_of_voice: z
    .number()
    .nullable()
    .describe('Its share of every tracked-business naming in the answers, 0–1.'),
  mention_count: z.number().int(),
  visibility_delta: z.number().nullable().optional().describe(DELTA),
  gap_count: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Answers that named this competitor but not the brand. Null on the brand row.'),
  matched_visibility_rate: z
    .number()
    .nullable()
    .optional()
    .describe('`mention_rate` over only the prompt and engine cells both runs measured.'),
  matched_visibility_delta: z
    .number()
    .nullable()
    .optional()
    .describe('`matched_visibility_rate` minus the baseline, in points; only on `matched_subset`.'),
  matched_response_count: z.number().int().nullable().optional(),
  avg_position: AVG_POSITION,
  ...winCountsSchema.shape,
  sentiment: netSentimentSchema
    .nullable()
    .optional()
    .describe(
      'Tone where it was named. Null: no classified answer, or measured without perception.',
    ),
});

// Selected-run dashboard projection (`VisibilityResponse`). Computed
// server-side from the persisted MetricSnapshot for the selected audit
// (defaults to the latest completed audit). No cross-run trend in this payload
// — the Trends tab reads /visibility/trends for that.
export const visibilityComparisonSchema = responseObject({
  status: z
    .string()
    .describe(
      '`comparable`, `matched_subset`, `partial_coverage`, `coverage_unavailable`, `no_observations`, `changed_context`, `identity_unavailable`, `no_baseline` or `baseline_pending`.',
    ),
  baseline_audit_id: uuid().nullable(),
  baseline_audit_ids: z.array(uuid()),
  baseline_at: z.string().nullable(),
  baseline_counts: measurementCountsSchema.nullable(),
  current_counts: measurementCountsSchema.nullable(),
  deltas: z
    .record(z.string(), z.number().nullable())
    .describe(
      'Change per metric against the baseline, rates in percentage points: over every cell when `comparable`, over the shared cells on `matched_subset`, empty otherwise.',
    ),
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
  total_failed: z.number().int().nullable().describe(`Answers that failed. ${UNKNOWN}`),
  visibility_score: z.number().nullable().describe(SCORE),
  visibility_rate: MENTION_RATE.optional(),
  owned_citation_rate: OWNED_RATE.optional(),
  prompt_performance_score: z.number().nullable().optional(),
  counts: measurementCountsSchema.optional(),
  comparison_key: z.string().nullable().optional(),
  comparison: visibilityComparisonSchema.optional(),
  citation_totals: z
    .object({
      citations: z.number().int(),
      owned_citations: z.number().int(),
      owned_share: z.number().nullable(),
    })
    .optional(),
  selection_mode: z
    .enum(['latest', 'run', 'range'])
    .optional()
    .describe(
      'How the selection resolved, not what was asked: without `audit_id` or a range it is `latest`.',
    ),
  source_audit_ids: z.array(uuid()).optional().describe('The runs this projection counts.'),
  configuration_groups: z.record(z.string(), z.number().int()).optional(),
  from_at: z.string().nullable().optional(),
  to_at: z.string().nullable().optional(),
  model_provenance: z.array(modelProvenanceSchema).default([]),
  rankings: z.array(rankingRowSchema),
  per_engine: z.array(visibilityEngineSchema),
  avg_position: AVG_POSITION,
  created_at: z.string(),
});

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
  composite_score: z
    .number()
    .nullable()
    .describe(
      'Prompt score, 0–100: mention rate, own-citation rate and (with competitors) competitive position, weighted.',
    ),
  source_audit_ids: z.array(uuid()).optional(),
  previous_score: z.number().nullable().describe("The previous run's prompt score."),
  immediate_delta: z.number().nullable().describe('Score change in points since the previous run.'),
  rolling_four: z.array(z.number()).describe('This score and up to three before it, newest first.'),
  per_engine_scores: z.record(z.string(), z.number()).describe('Prompt score per logical engine.'),
  components: z
    .record(z.string(), z.number().nullable())
    .describe(
      'The score inputs, 0–1: `visibility`, `owned_citations` and, with competitors, `competitive_position`.',
    ),
  engine_agreement: z
    .number()
    .describe('Share of engines, 0–1, whose score fell materially since the previous run.'),
  repetition_agreement: z
    .number()
    .describe("How consistently repeated asks agreed on the brand's mention, 0–1."),
  evidence_coverage: z.number().describe('Answers received over answers expected, 0–1.'),
  trend_confidence: z.number().describe('The mean of the three agreement and coverage values.'),
  decline_confirmed: z
    .boolean()
    .describe('A material drop repeated across runs and engines, not one noisy run.'),
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  created_at: z.string(),
  theme: z.string().optional(),
  intent: z.string().optional(),
  visibility_rate: MENTION_RATE.optional(),
  owned_citation_rate: OWNED_RATE.optional(),
  avg_position: AVG_POSITION.optional(),
  ...winCountsSchema.shape,
  share_of_voice: z
    .number()
    .nullable()
    .optional()
    .describe("The brand's share of every tracked-business naming in these answers, 0–1."),
  sentiment: netSentimentSchema
    .nullable()
    .optional()
    .describe("The brand's tone here. Null: measured without perception."),
  web_search: webSearchShareSchema.optional(),
  visibility_delta: z.number().nullable().optional().describe(DELTA),
  comparison_status: z
    .string()
    .optional()
    .describe(
      'As `comparison.status`, or `no_matching_prompt` when the baseline lacks this prompt.',
    ),
  comparison: visibilityComparisonSchema.nullable().optional(),
  counts: measurementCountsSchema.optional(),
  answer_states: answerStatesSchema.nullable().optional(),
  action_id: uuid().nullable().optional().describe('The Action targeting this prompt, if any.'),
  mentions: z.number().int().describe('Distinct businesses named in these answers.'),
  brands: z.array(namedBrandSchema).describe('The leading few named, most answers first.'),
  named: z
    .array(namedBrandSchema.pick({ kind: true, name: true }))
    .optional()
    .describe('With `latest=prompt` only: every business named.'),
  sources: z
    .array(citedDomainSchema)
    .optional()
    .describe('With `latest=prompt` only: every domain cited, most citations first.'),
  outcomes: z
    .array(
      responseObject({
        logical_engine: z.string(),
        transport_model: z.string(),
        counts: measurementCountsSchema,
        visibility_rate: MENTION_RATE,
        owned_citation_rate: OWNED_RATE,
        answer_states: answerStatesSchema.nullable().optional(),
        gap_counts: z
          .record(z.string(), z.number().int())
          .describe('Per competitor: answers that named it but not the brand.'),
      }),
    )
    .optional(),
});

export const promptHistoryPointSchema = responseObject({
  audit_id: uuid(),
  completed_at: z.string(),
  prompt_text: z.string(),
  counts: measurementCountsSchema,
  mention_rate: MENTION_RATE,
  owned_citation_rate: OWNED_RATE,
  answer_states: answerStatesSchema.nullable(),
  source_analysis_ids: z.array(uuid()).describe('Provenance: the answers these rates count.'),
  comparison_key: z.string().nullable(),
  analyzer_version: z.string(),
  scoring_rule_version: z.string(),
  comparable_with_previous: z
    .boolean()
    .nullable()
    .describe(
      'False when the measurement context, prompt text or analyzer/scoring versions changed since the previous point; null on the first.',
    ),
  source_snapshot_id: uuid().describe('Provenance: the persisted prompt score this point reads.'),
});

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
  implementations: z
    .array(promptHistoryImplementationSchema)
    .describe('Actions that went live for this prompt: markers, never attribution.'),
  latest: promptMetricItemSchema
    .nullable()
    .describe('The newest run that measured the prompt, with per-engine outcomes.'),
});

const observedCompetitorFields = {
  id: uuid(),
  audit_id: uuid().describe('The run whose answers suggested it.'),
  name: z.string(),
  qualification_reason: z.string(),
  prompt_count: z.number().int().describe('Prompts whose answers named or cited it.'),
  engine_count: z.number().int().describe('Engines whose answers named or cited it.'),
  engine_total: z.number().int().describe('Engines the run asked.'),
  market_relevant: z.boolean(),
  analyzer_version: z.string(),
  source_analysis_ids: z.array(z.string()).describe('Provenance: the answers it came from.'),
  source_artifact_ids: z.array(z.string()),
  status: z.string().describe('`pending`, `accepted` or `rejected`.'),
  created_at: z.string(),
};

export const observedCompetitorSchema = z.discriminatedUnion('kind', [
  responseObject({
    ...observedCompetitorFields,
    kind: z.literal('cited_domain'),
    domain: z.string(),
    citation_count: z.number().int().describe('Citations of the domain.'),
  }),
  responseObject({ ...observedCompetitorFields, kind: z.literal('named_in_answers') }),
]);

const discoveryProfileSchema = responseObject({
  description: z.string(),
  positioning: z.string(),
  products_services: z.array(z.string()),
  target_audience: z.string(),
  industry: z.string(),
  business_type: buyerTypeSchema.nullable(),
  price_tier: z.string(),
  field_confidence: z.record(z.string(), z.number()),
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

export const brandDiscoveryCompleteSchema = responseObject({
  discovery_id: uuid(),
  project_id: uuid().nullable(),
  warnings: z.array(z.string()),
});

export const visibilityMarketRowSchema = responseObject({
  market: projectMarketSchema,
  state: z.enum(['measured', 'no_run', 'metrics_pending']),
  audit_id: uuid().nullable(),
  measured_at: z.string().nullable(),
  responses: z.number().int().nullable(),
  mention_rate: z.number().nullable(),
  share_of_voice: z.number().nullable(),
  sentiment: netSentimentSchema.nullable(),
  comparison_status: z.string().nullable(),
  mention_rate_delta: z.number().nullable(),
  share_of_voice_delta: z.number().nullable(),
});
export const visibilityMarketsSchema = responseObject({
  cohort: visibilityCohortSchema,
  markets: z.array(visibilityMarketRowSchema),
});
export type VisibilityMarkets = z.infer<typeof visibilityMarketsSchema>;
export type PromptMetricItem = z.infer<typeof promptMetricItemSchema>;
export type PromptHistory = z.infer<typeof promptHistorySchema>;
export type ObservedCompetitor = z.infer<typeof observedCompetitorSchema>;
export type VisibilityEngine = z.infer<typeof visibilityEngineSchema>;
export type RankingRow = z.infer<typeof rankingRowSchema>;
export type NetSentiment = z.infer<typeof netSentimentSchema>;
export type WebSearchShare = z.infer<typeof webSearchShareSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
