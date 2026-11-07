/**
 * Request bodies of the prompt library: prompt sets, prompts, imports,
 * generation, candidate review and topics. These own the wire shape; the API
 * `.extend`s each with its configured length and count bounds, and the
 * browser types its arguments as `z.input` of them.
 */
import { z } from 'zod';

import { buyerStageSchema, promptCohortSchema, promptStatusSchema } from './project.ts';

const uuid = () => z.uuid();

export const promptSetCreateRequestSchema = z.object({
  project_id: uuid(),
  name: z.string().default(''),
  description: z.string().default(''),
});
export type PromptSetCreateRequest = z.input<typeof promptSetCreateRequestSchema>;

export const promptSetUpdateRequestSchema = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
});

/**
 * A new prompt. Theme, intent and cohort are internal vocabulary: omitting
 * them takes the server's defaults, and an omitted cohort is filed by whether
 * the text names the brand. `topic_id` files the prompt under an existing
 * topic of the prompt's own project.
 */
export const promptCreateRequestSchema = z.strictObject({
  text: z.string().trim().min(1),
  theme: z.string().default(''),
  intent: z.string().default(''),
  buyer_stage: buyerStageSchema.default(''),
  persona: z.string().trim().default(''),
  cohort: promptCohortSchema.optional(),
  enabled: z.boolean().default(true),
  topic_id: uuid().nullish(),
});
export type PromptCreateRequest = z.input<typeof promptCreateRequestSchema>;

/** A partial prompt edit; an explicit null `topic_id` detaches the prompt from its topic. */
export const promptUpdateRequestSchema = z.strictObject({
  text: z.string().trim().min(1).nullish(),
  theme: z.string().nullish(),
  intent: z.string().nullish(),
  buyer_stage: buyerStageSchema.nullish(),
  persona: z.string().trim().nullish(),
  cohort: promptCohortSchema.nullish(),
  enabled: z.boolean().nullish(),
  status: promptStatusSchema.nullish(),
  topic_id: uuid().nullish(),
});
export type PromptUpdateRequest = z.input<typeof promptUpdateRequestSchema>;

export const promptBulkStatusRequestSchema = z.strictObject({
  prompt_ids: z.array(uuid()).min(1),
  status: promptStatusSchema,
});
export type PromptBulkStatusRequest = z.input<typeof promptBulkStatusRequestSchema>;

/** One browser-parsed CSV row: the user's topic NAME (created when new, '' = none). */
export const promptImportRowRequestSchema = z.strictObject({
  text: z.string().trim(),
  theme: z.string().default(''),
  intent: z.string().default(''),
  buyer_stage: buyerStageSchema.default(''),
  persona: z.string().trim().default(''),
  cohort: promptCohortSchema.optional(),
  enabled: z.boolean().default(true),
  topic: z.string().trim().default(''),
});
export type PromptImportRowRequest = z.input<typeof promptImportRowRequestSchema>;

export const promptImportRequestSchema = z.strictObject({
  prompts: z.array(promptImportRowRequestSchema),
});

const share = z.number().min(0).max(1);
const weight = z.number().min(0).max(100);
/**
 * How a run's cells divide: branded (`brand_diagnostic`) and competitor
 * (`comparison`) shares, the rest core; an intent mix that weights the stage
 * labels; and personas that become the run's audience facets.
 */
export const promptGenerationDistributionRequestSchema = z.object({
  branded_share: share.default(0),
  comparison_share: share.default(0),
  intent_mix: z
    .object({ informational: weight, commercial: weight, transactional: weight })
    .refine((mix) => mix.informational + mix.commercial + mix.transactional > 0, {
      message: 'Intent mix needs at least one positive share',
    })
    .nullish(),
  personas: z.array(z.string().trim().min(1)).default([]),
});
/** The distribution's whole-run rule, applied after the API bounds its personas. */
export const distributionWithinRun = (value: { branded_share: number; comparison_share: number }) =>
  value.branded_share + value.comparison_share <= 1;
export const DISTRIBUTION_EXCEEDS_RUN = 'Branded and comparison shares cannot exceed the whole run';

/** Which persisted searches may steer wording; omitted reads every source. */
const promptSeedSourceSchema = z.enum(['search_console', 'search_intelligence', 'none']);
/** Prompt cohorts a run can plan, core first so it wins ties. */
export const promptGenerationCohortSchema = z.enum(['core', 'brand_diagnostic', 'comparison']);

/**
 * An AI generation run. Omitted `topic_ids` is every topic; `run_context` is a
 * note for this run only, never saved as a business fact; omitted
 * `distribution` is a core-only run with stages balanced.
 */
export const promptGenerateRequestSchema = z.object({
  count: z.number().int().min(1).optional(),
  topic_ids: z.array(uuid()).default([]),
  topic_id: uuid().nullish(),
  cohort: promptGenerationCohortSchema.default('core'),
  run_context: z.string().trim().nullish(),
  distribution: promptGenerationDistributionRequestSchema
    .refine(distributionWithinRun, { message: DISTRIBUTION_EXCEEDS_RUN })
    .nullish(),
  seed_source: promptSeedSourceSchema.nullish(),
  seed_query_ids: z.array(uuid()).default([]),
});
export type PromptGenerateRequest = z.input<typeof promptGenerateRequestSchema>;

/** Accept candidates as active prompts or reject them. */
export const promptCandidateReviewRequestSchema = z.object({
  accept_ids: z.array(uuid()).default([]),
  reject_ids: z.array(uuid()).default([]),
});
export type PromptCandidateReviewRequest = z.input<typeof promptCandidateReviewRequestSchema>;

/** A topic; `parent_id` makes a subtopic of a top-level topic (one level deep). */
export const topicCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(''),
  parent_id: uuid().nullish(),
});
export type TopicCreateRequest = z.input<typeof topicCreateRequestSchema>;

export const topicUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).nullish(),
  description: z.string().nullish(),
  parent_id: uuid().nullish(),
});
export type TopicUpdateRequest = z.input<typeof topicUpdateRequestSchema>;

/**
 * The Prompt Builder's reviewed topic plan, applied at once: proposals and new
 * topics to create (a proposal names the saved offerings it covers), existing
 * topics to rename and existing topics to delete.
 */
export const topicConfirmRequestSchema = z.object({
  create: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        offerings: z.array(z.string().trim().min(1)).default([]),
      }),
    )
    .default([]),
  rename: z.array(z.object({ id: uuid(), name: z.string().trim().min(1) })).default([]),
  delete: z.array(uuid()).default([]),
});
export type TopicConfirmRequest = z.input<typeof topicConfirmRequestSchema>;
/** A complete plan, every list present: what the Prompt Builder assembles. */
export type TopicConfirmPlan = z.infer<typeof topicConfirmRequestSchema>;
