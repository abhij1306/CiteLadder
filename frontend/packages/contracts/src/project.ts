import { z } from 'zod';

const responseObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape);
const uuid = () => z.uuid();

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
  'evaluation',
]);

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

export const promptStatusSchema = z.enum(['active', 'archived']);
export const promptCohortSchema = z.enum(['core', 'brand_diagnostic', 'comparison', 'commerce']);

export const promptSchema = responseObject({
  id: uuid(),
  prompt_set_id: uuid(),
  topic_id: uuid().nullable().optional(),
  text: z.string(),
  theme: z.string(),
  intent: promptIntentSchema,
  buyer_stage: buyerStageSchema.default(''),
  prompt_intent: promptIntentDetailSchema.default(''),
  persona: z.string().default(''),
  cohort: promptCohortSchema,
  branded: z.boolean(),
  enabled: z.boolean(),
  status: promptStatusSchema,
  origin: z.enum(['manual', 'imported', 'generated']),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const topicSchema = responseObject({
  id: uuid(),
  project_id: uuid(),
  parent_id: uuid().nullable().default(null),
  name: z.string(),
  description: z.string(),
  origin: z.enum(['manual', 'generated']),
  active_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const projectThemeSchema = responseObject({
  id: uuid(),
  name: z.string(),
  source: z.enum(['research', 'user', 'model']),
});

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
  quality_status: z.enum(['judged', 'off', 'unavailable', 'not_judged']).default('not_judged'),
  quality_flags: z.array(z.string()).default([]),
  grounded: z.boolean().default(false),
});

const promptAdmissionDropReasons = [
  'unknown_topic',
  'unplanned_slot',
  'intent',
  'stage',
  'duplicate',
  'length',
  'too_many_words',
  'placeholder',
  'two_needs',
  'advice',
  'observed_copy',
  'off_topic',
  'location_unplanned',
  'branded_core',
  'brand_missing',
  'competitor_missing',
  'near_duplicate',
] as const;
const promptAdmissionDropReasonSchema = z.enum(promptAdmissionDropReasons);
export type PromptAdmissionDropReason = z.infer<typeof promptAdmissionDropReasonSchema>;

export const promptGenerateResponseSchema = responseObject({
  candidates: z.array(promptCandidateSchema),
  topics: z.array(topicSchema),
  dropped_duplicates: z.number().int(),
  requested_count: z.number().int().default(0),
  candidates_generated: z.number().int().default(0),
  quality_gate: z.enum(['off', 'shadow', 'gate', 'unavailable']).default('off'),
  quality_rejected: z.number().int().default(0),
  admission_drops: z
    .partialRecord(promptAdmissionDropReasonSchema, z.number().int().nonnegative())
    .default({}),
  shortfall_reason: z.enum(['deadline', 'model_error']).nullable().default(null),
});

export const promptCandidateReviewResponseSchema = responseObject({
  accepted: z.array(promptSchema),
  rejected_count: z.number().int(),
  dropped_duplicates: z.number().int(),
  unavailable_count: z.number().int(),
});

const topicProposalSchema = responseObject({
  name: z.string(),
  offerings: z.array(z.string()),
});

export const topicPreviewResponseSchema = responseObject({
  source: z.enum(['model', 'offerings']),
  topics: z.array(topicProposalSchema),
  overflow: z.array(topicProposalSchema),
});

export const seedQuerySourceSchema = z.enum(['search_console', 'search_intelligence']);

export const seedQueriesResponseSchema = responseObject({
  sources: z.array(
    responseObject({
      source: seedQuerySourceSchema,
      queries: z.array(responseObject({ id: uuid(), text: z.string(), topic_id: uuid() })),
    }),
  ),
});

export const businessMapEntrySchema = responseObject({
  value: z.string(),
  origin: z.enum(['manual', 'model']),
  review_state: z.enum(['suggested', 'confirmed']),
  reviewed_by: z.string().nullable().default(null),
  reviewed_at: z.string().nullable().default(null),
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

export const buyerTypeSchema = z.enum(['b2b', 'b2c', 'both']);
export const marketScopeSchema = z.enum(['global', 'national', 'regional', 'local']);
export const businessModelSchema = z.enum([
  'b2b_saas',
  'marketplace',
  'd2c_product',
  'retail',
  'local_service',
  'professional_service',
  'regulated_finance',
  'healthcare_provider',
  'education_provider',
]);

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
  kind: z.enum(['brand', 'commerce']),
  description: z.string().optional(),
  prompt_count: z.number().int().optional(),
  prompts: z.array(promptSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const promptFormLimitsSchema = responseObject({
  generation_count_max: z.number().int(),
  brand_prompts_max: z.number().int(),
  brand_generation_calls: z.number().int(),
  import_rows_max: z.number().int(),
  bulk_prompts_max: z.number().int(),
  persona_max_chars: z.number().int(),
  run_context_max_chars: z.number().int(),
  distribution_personas_max: z.number().int(),
  seed_query_ids_max: z.number().int(),
  context_list_max_entries: z.number().int(),
  audit_repetitions_min: z.number().int(),
  audit_repetitions_max: z.number().int(),
});

export const promptBulkResultSchema = responseObject({ count: z.number().int() });

export const promptSetListSchema = responseObject({
  prompt_sets: z.array(promptSetSchema),
  limits: promptFormLimitsSchema,
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
    alias_suggestions: z.array(z.string()),
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

export const projectSummarySchema = responseObject({
  id: uuid(),
  name: z.string(),
  brand_name: z.string(),
  website_url: z.string(),
  brand: responseObject({ logo_url: z.string().nullable().optional() }),
});

export type BrandProfileDraft = z.infer<typeof brandProfileDraftSchema>;
export type BrandProfile = z.infer<typeof brandProfileSchema>;
export type PromptIntent = z.infer<typeof promptIntentSchema>;
export type BuyerStage = z.infer<typeof buyerStageSchema>;
export type Prompt = z.infer<typeof promptSchema>;
export type PromptStatus = z.infer<typeof promptStatusSchema>;
export type PromptSet = z.infer<typeof promptSetSchema>;
export type PromptFormLimits = z.infer<typeof promptFormLimitsSchema>;
export type PromptSetList = z.infer<typeof promptSetListSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type ProjectTheme = z.infer<typeof projectThemeSchema>;
export type TopicPreview = z.infer<typeof topicPreviewResponseSchema>;
export type SeedQueries = z.infer<typeof seedQueriesResponseSchema>;
export type PromptGenerateResponse = z.infer<typeof promptGenerateResponseSchema>;
export type PromptCandidate = z.infer<typeof promptCandidateSchema>;
export type PromptCandidateReviewResponse = z.infer<typeof promptCandidateReviewResponseSchema>;
export type BusinessMap = z.infer<typeof businessMapSchema>;
export type BusinessMapEntry = z.infer<typeof businessMapEntrySchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type EntityMatching = z.infer<typeof entityMatchingSchema>;
