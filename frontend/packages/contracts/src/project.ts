import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

// ---------------------------------------------------------------------------
// Brand / project / prompts
// ---------------------------------------------------------------------------

// When a brand or competitor name counts as a mention. `context_required`
// counts an occurrence only with a context term nearby; an exclusion phrase
// ("target audience") never counts. `common_word` marks a name that is an
// ordinary word, which defaults to needing context.
export const entityMatchingModeSchema = z.enum(['always', 'context_required']);
export const entityMatchingSchema = responseObject({
  mode: entityMatchingModeSchema,
  context_terms: z.array(z.string()).default([]),
  exclusion_phrases: z.array(z.string()).default([]),
  common_word: z.boolean().default(false),
});

export const competitorSchema = responseObject({
  id: uuid(),
  name: z.string(),
  aliases: z.array(z.string()),
  domains: z.array(z.string()),
  logo_url: z.string().nullable().optional(),
  matching: entityMatchingSchema.optional(),
});

// Intent enum. The backend `normalize_intent` casefolds a free-text intent
// and normalizes any empty/unknown value to `''` ("unspecified"), so `''` is a
// valid on-the-wire value and must be accepted here (contract, not UI sugar).
export const promptIntentSchema = z.enum([
  '',
  'discovery',
  'comparison',
  'purchase',
  'service',
  'local',
]);

// Where in the buyer journey a generated prompt sits, and what the person
// wants from the answer. Empty for manual and imported prompts, which never
// went through the backend's buyer-query slot planner.
export const buyerStageSchema = z.enum([
  '',
  'awareness',
  'consideration',
  'decision',
  'implementation',
]);
export const promptIntentDetailSchema = z.enum([
  '',
  'learn',
  'solve',
  'compare',
  'recommend',
  'validate',
  'buy',
  'implement',
]);

// Prompt library lifecycle. Measurement still requires an explicit audit run
// or schedule; generated prompts do not need a second approval state.
export const promptStatusSchema = z.enum(['active', 'archived']);
export const promptCohortSchema = z.enum(['core', 'brand_diagnostic', 'comparison', 'commerce']);

// Backend `PromptResponse.theme` is a non-null string (empty when unset), so
// the wire value is always a string — never null.
export const promptSchema = responseObject({
  id: uuid(),
  prompt_set_id: uuid(),
  topic_id: uuid().nullable().optional(),
  text: z.string(),
  theme: z.string(),
  intent: promptIntentSchema,
  buyer_stage: buyerStageSchema.default(''),
  prompt_intent: promptIntentDetailSchema.default(''),
  // The buyer the prompt is asked as; empty when none was planned or set.
  persona: z.string().default(''),
  cohort: promptCohortSchema,
  branded: z.boolean(),
  enabled: z.boolean(),
  status: promptStatusSchema,
  origin: z.enum(['manual', 'imported', 'generated']),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// A topical category grouping prompts within a project (first-class resource;
// `active_count` is the active-prompt projection for the topics rail).
export const topicSchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  // One level of nesting: a subtopic names its top-level parent.
  parent_id: uuid().nullable().default(null),
  name: z.string(),
  description: z.string(),
  origin: z.enum(['manual', 'generated']),
  active_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

// A generated prompt awaiting review. It is never audited, charged to prompt
// capacity or counted until a user accepts it.
export const promptCandidateSchema = responseObject({
  id: uuid(),
  run_id: uuid(),
  prompt_set_id: uuid(),
  topic_id: uuid().nullable().default(null),
  text: z.string(),
  intent: z.string().default(''),
  buyer_stage: buyerStageSchema.default(''),
  prompt_intent: promptIntentDetailSchema.default(''),
  cohort: promptCohortSchema,
  created_at: z.string(),
  expires_at: z.string(),
  // Quality judge: judged; off (no judge for its run); unavailable (the judge
  // failed or timed out); not_judged (past the call cap, or a run from before
  // the judge). A listed row was never failed by the gate; its flags inform
  // review.
  quality_status: z.enum(['judged', 'off', 'unavailable', 'not_judged']).default('not_judged'),
  quality_flags: z.array(z.string()).default([]),
  // Phrasing was guided by the project's own Search Console or keyword
  // research queries. Never carries the queries, their identities or volume.
  grounded: z.boolean().default(false),
});

// Why a drafted or proposed row failed admission, one code per dropped row.
const promptAdmissionDropReasons = [
  'unknown_topic',
  'unplanned_slot',
  'intent',
  'stage',
  'duplicate',
  'length',
  // Over the 16-word cap: a buyer types a short question.
  'too_many_words',
  'placeholder',
  'observed_copy',
  'off_topic',
  'location_unplanned',
  'branded_core',
  'brand_missing',
  'competitor_missing',
  // Asks what a tracked prompt, a pending candidate or an earlier draft asks.
  'near_duplicate',
] as const;
const promptAdmissionDropReasonSchema = z.enum(promptAdmissionDropReasons);
export type PromptAdmissionDropReason = z.infer<typeof promptAdmissionDropReasonSchema>;

// `POST /prompt-sets/{id}/generate` result: staged candidates, the topics
// they belong to, and how many duplicates were dropped.
export const promptGenerateResponseSchema = responseObject({
  candidates: z.array(promptCandidateSchema),
  topics: z.array(topicSchema),
  dropped_duplicates: z.number().int(),
  // What was asked for. The plan can be smaller than the request when the
  // selected topics cannot support it, and saying so beats returning fewer
  // prompts with no explanation.
  requested_count: z.number().int().default(0),
  // Suggestions that passed admission before selection. Never a market size.
  candidates_generated: z.number().int().default(0),
  // off (no judge configured) | shadow (decisions recorded) | gate (strong
  // fails removed before review) | unavailable.
  quality_gate: z.enum(['off', 'shadow', 'gate', 'unavailable']).default('off'),
  // Suggestions the quality gate removed before review.
  quality_rejected: z.number().int().default(0),
  // Rows that failed admission, by reason; copies of tracked or pending
  // questions count as `duplicate`.
  admission_drops: z
    .partialRecord(promptAdmissionDropReasonSchema, z.number().int().nonnegative())
    .default({}),
  // Why drafting stopped before every planned question was tried: the request
  // deadline, or a provider failure after some questions were admitted. Null
  // when drafting finished; a short set without a reason was limited by
  // admission or the selected topics.
  shortfall_reason: z.enum(['deadline', 'model_error']).nullable().default(null),
});

// `POST /prompt-sets/{id}/candidates/review` result.
export const promptCandidateReviewResponseSchema = responseObject({
  accepted: z.array(promptSchema),
  rejected_count: z.number().int(),
  dropped_duplicates: z.number().int(),
  unavailable_count: z.number().int(),
});

// Business map: per-offering facts that ground generation. Entries carry
// provenance; a model suggestion stays `suggested` until a person confirms it.
export const businessMapEntrySchema = responseObject({
  value: z.string(),
  origin: z.enum(['manual', 'model']),
  review_state: z.enum(['suggested', 'confirmed']),
  reviewed_by: z.string().nullable().default(null),
  reviewed_at: z.string().nullable().default(null),
  // Model identity and time for a suggestion; empty for manual entries.
  source: z.record(z.string(), z.unknown()).default({}),
});

const businessMapExclusionSchema = responseObject({
  first: z.string(),
  second: z.string(),
});

export const offeringMapSchema = responseObject({
  offering: z.string(),
  attributes: z.array(businessMapEntrySchema),
  situations: z.array(businessMapEntrySchema),
  audiences: z.array(businessMapEntrySchema),
  exclusions: z.array(businessMapExclusionSchema),
});

export const businessMapSchema = responseObject({
  offerings: z.array(offeringMapSchema),
  available_offerings: z.array(z.string()),
});

export const brandProfileSourceSchema = z.enum(['manual', 'web_evidence', 'ai_suggested']);
export const brandProfileReviewStateSchema = z.enum(['unreviewed', 'confirmed', 'edited']);

const brandProfileFieldProvenanceSchema = responseObject({
  origin: brandProfileSourceSchema,
  review_state: brandProfileReviewStateSchema,
  reviewed_by: uuid().nullable(),
  reviewed_at: z.string().nullable(),
});

const brandProfileFieldSourcesSchema = responseObject({
  description: brandProfileFieldProvenanceSchema.nullable(),
  positioning: brandProfileFieldProvenanceSchema.nullable(),
  products_services: brandProfileFieldProvenanceSchema.nullable(),
  target_audience: brandProfileFieldProvenanceSchema.nullable(),
});

const brandProfileSourceArtifactsSchema = responseObject({
  description: uuid().nullable(),
  positioning: uuid().nullable(),
  products_services: uuid().nullable(),
  target_audience: uuid().nullable(),
});

// Closed identity facets confirmed at onboarding and editable on the brand profile.
export const buyerTypeSchema = z.enum(['b2b', 'b2c', 'both']);
export const marketScopeSchema = z.enum(['global', 'national', 'regional', 'local']);

export const brandProfileDraftSchema = responseObject({
  description: z.string(),
  positioning: z.string(),
  products_services: z.array(z.string()),
  target_audience: z.string(),
});

export const brandProfileSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  project_id: uuid(),
  brand_id: uuid(),
  ...brandProfileDraftSchema.shape,
  // The confirmed onboarding context (category, facets, business map), so a
  // client can show what the project was built from.
  business_context: z.record(z.string(), z.unknown()),
  sources: brandProfileFieldSourcesSchema,
  source_artifact_ids: brandProfileSourceArtifactsSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const promptSetSchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  name: z.string(),
  // PromptSetResponse carries a description and a denormalized prompt_count.
  description: z.string().optional(),
  prompt_count: z.number().int().optional(),
  prompts: z.array(promptSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const benchmarkModeSchema = z.enum([
  'consumer_like',
  'controlled_localized',
  'forced_grounded',
]);

export const projectSchema = responseObject({
  id: uuid(),
  workspace_id: uuid(),
  name: z.string(),
  brand_name: z.string(),
  website_url: z.string(),
  industry: z.string(),
  subindustry: z.string(),
  primary_market: z.string(),
  country_code: z.string(),
  language_code: z.string(),
  benchmark_mode: benchmarkModeSchema,
  default_repetitions: z.number().int(),
  brand: responseObject({
    aliases: z.array(z.string()),
    logo_url: z.string().nullable().optional(),
    matching: entityMatchingSchema.optional(),
  }),
  owned_domains: z.array(z.string()),
  unintended_domains: z.array(z.string()),
  competitors: z.array(competitorSchema),
  prompt_sets: z.array(promptSetSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
