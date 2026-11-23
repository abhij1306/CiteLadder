import {
  DISTRIBUTION_EXCEEDS_RUN,
  distributionWithinRun,
  promptGenerateRequestSchema,
  promptGenerationCohortSchema,
  promptGenerationDistributionRequestSchema,
} from '@citeladder/contracts/prompt-requests';
import { z } from 'zod';

import { policy } from '../config.ts';
import { resolveSettingSpec } from '../config/settings.ts';
import { ApiError } from '../errors.ts';
import { compareText } from '../text-order.ts';

const G = policy.prompts.generation;
export const generationSetting = (name: keyof typeof policy.prompts.generation_settings) =>
  Number(resolveSettingSpec(policy.prompts.generation_settings[name], process.env));

const generationDistribution = promptGenerationDistributionRequestSchema
  .extend({
    personas: z
      .array(z.string().trim().min(1).max(policy.prompts.persona_max_chars))
      .max(G.distribution_personas_max)
      .default([]),
  })
  .refine(distributionWithinRun, { message: DISTRIBUTION_EXCEEDS_RUN });
export const generationCohorts = promptGenerationCohortSchema.options;

export const generationInput = promptGenerateRequestSchema.extend({
  count: z
    .number()
    .int()
    .min(1)
    .default(() => generationSetting('default_count')),
  run_context: z.string().trim().max(G.run_context_max_chars).nullish(),
  distribution: generationDistribution.nullish(),
  seed_query_ids: z.array(z.uuid()).max(G.seed_query_ids_max).default([]),
});
export type GenerationInput = z.infer<typeof generationInput>;
export type GenerationCohort = GenerationInput['cohort'];
export const needsCompetitor = (input: GenerationInput) =>
  input.mode === 'market' && cohortShares(input).comparison > 0;
export const generationInvalid = (message: string) =>
  new ApiError(422, message, { code: 'generation_invalid' });
export const wantedTopics = (input: GenerationInput) => [
  ...new Set([...input.topic_ids, ...(input.topic_id ? [input.topic_id] : [])]),
];

const B = policy.prompts.brand;
const brandComparisonShare =
  B.angles.filter((angle) => angle.cohort === 'comparison').length / B.angles.length;

export function cohortShares(
  input: Pick<GenerationInput, 'mode' | 'cohort' | 'distribution'>,
): Record<GenerationCohort, number> {
  if (input.mode === 'brand')
    return {
      core: 0,
      brand_diagnostic: 1 - brandComparisonShare,
      comparison: brandComparisonShare,
    };
  if (!input.distribution)
    return {
      core: Number(input.cohort === 'core'),
      brand_diagnostic: Number(input.cohort === 'brand_diagnostic'),
      comparison: Number(input.cohort === 'comparison'),
    };
  const { branded_share, comparison_share } = input.distribution;
  return {
    core: Math.max(0, 1 - branded_share - comparison_share),
    brand_diagnostic: branded_share,
    comparison: comparison_share,
  };
}

export function draftCallLimit(
  input: Pick<GenerationInput, 'count' | 'mode' | 'cohort' | 'distribution'>,
) {
  const cells = input.count * generationSetting('overgenerate_factor'),
    size = generationSetting('model_batch_size');
  const batches = Object.values(cohortShares(input))
    .filter((share) => share > 0)
    .reduce((sum, share) => sum + Math.ceil((cells * share) / size), 0);
  return Math.max(1, batches) + 1;
}

export function requestKey(input: GenerationInput) {
  return JSON.stringify({
    count: input.count,
    mode: input.mode,
    cohort: input.cohort,
    topics: wantedTopics(input).toSorted(compareText),
    run_context: input.run_context || null,
    distribution: input.distribution
      ? { ...input.distribution, intent_mix: input.distribution.intent_mix ?? null }
      : null,
    seed_source: input.seed_source ?? null,
    seed_query_ids: input.seed_query_ids.toSorted(compareText),
  });
}

export function validateRequest(input: GenerationInput) {
  if (input.count > generationSetting('max_count'))
    throw generationInvalid('Requested count exceeds generation limit');
  if (wantedTopics(input).length > generationSetting('max_topic_ids'))
    throw generationInvalid('Too many topics selected');
  if (input.distribution && input.cohort !== 'core')
    throw generationInvalid('A distribution plans its own cohorts; leave the cohort as core');
  if (input.mode === 'brand') validateBrandRequest(input);
  if (input.seed_query_ids.length && (!input.seed_source || input.seed_source === 'none'))
    throw generationInvalid('Seed queries need their search data source');
}

function validateBrandRequest(input: GenerationInput) {
  if (input.count > B.max_per_run)
    throw generationInvalid(`Brand prompts are suggested at most ${B.max_per_run} at a time`);
  if (
    input.distribution ||
    input.cohort !== 'core' ||
    input.seed_source ||
    input.seed_query_ids.length
  )
    throw generationInvalid(
      'Brand prompts plan their own questions; send no cohort, distribution or search data',
    );
}

export function validateSelection(input: GenerationInput, topics: readonly { id: string }[]) {
  validateRequest(input);
  if (wantedTopics(input).some((id) => !topics.some((topic) => topic.id === id)))
    throw generationInvalid('Selected topic is unavailable in this project');
}
