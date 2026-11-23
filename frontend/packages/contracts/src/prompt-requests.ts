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

export const promptBulkDeleteRequestSchema = z.strictObject({
  prompt_ids: z.array(uuid()).min(1),
});
export type PromptBulkDeleteRequest = z.input<typeof promptBulkDeleteRequestSchema>;

export const promptBulkTopicRequestSchema = promptBulkDeleteRequestSchema.extend({
  topic_id: uuid().nullable(),
});
export type PromptBulkTopicRequest = z.input<typeof promptBulkTopicRequestSchema>;

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
export const distributionWithinRun = (value: { branded_share: number; comparison_share: number }) =>
  value.branded_share + value.comparison_share <= 1;
export const DISTRIBUTION_EXCEEDS_RUN = 'Branded and comparison shares cannot exceed the whole run';

const promptSeedSourceSchema = z.enum(['search_console', 'search_intelligence', 'none']);
export const promptGenerationModeSchema = z.enum(['market', 'brand']);
export const promptGenerationCohortSchema = z.enum(['core', 'brand_diagnostic', 'comparison']);

export const promptGenerateRequestSchema = z.object({
  count: z.number().int().min(1).optional(),
  topic_ids: z.array(uuid()).default([]),
  topic_id: uuid().nullish(),
  mode: promptGenerationModeSchema.default('market'),
  cohort: promptGenerationCohortSchema.default('core'),
  run_context: z.string().trim().nullish(),
  distribution: promptGenerationDistributionRequestSchema
    .refine(distributionWithinRun, { message: DISTRIBUTION_EXCEEDS_RUN })
    .nullish(),
  seed_source: promptSeedSourceSchema.nullish(),
  seed_query_ids: z.array(uuid()).default([]),
});
export type PromptGenerateRequest = z.input<typeof promptGenerateRequestSchema>;

export const promptCandidateReviewRequestSchema = z.object({
  accept_ids: z.array(uuid()).default([]),
  reject_ids: z.array(uuid()).default([]),
});
export type PromptCandidateReviewRequest = z.input<typeof promptCandidateReviewRequestSchema>;

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
export type TopicConfirmPlan = z.infer<typeof topicConfirmRequestSchema>;
