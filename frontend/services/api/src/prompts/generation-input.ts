import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { ApiError } from '../errors.ts';
import { compareText } from '../text-order.ts';

const G = policy.prompts.generation;
export const generationSetting = (name: keyof typeof policy.prompts.generation_settings) =>
  Number(resolveSettingSpec(policy.prompts.generation_settings[name]));

const share = z.number().min(0).max(1);
const weight = z.number().min(0).max(100);
/**
 * How a run's cells divide: branded (`brand_diagnostic`) and competitor
 * (`comparison`) shares, the rest core; an intent mix that weights the stage
 * labels; and personas that become the run's audience facets.
 */
const generationDistribution = z
  .object({
    branded_share: share.default(0),
    comparison_share: share.default(0),
    intent_mix: z
      .object({ informational: weight, commercial: weight, transactional: weight })
      .refine((mix) => mix.informational + mix.commercial + mix.transactional > 0, {
        message: 'Intent mix needs at least one positive share',
      })
      .nullish(),
    personas: z
      .array(z.string().trim().min(1).max(policy.prompts.persona_max_chars))
      .max(G.distribution_personas_max)
      .default([]),
  })
  .refine((value) => value.branded_share + value.comparison_share <= 1, {
    message: 'Branded and comparison shares cannot exceed the whole run',
  });
/** Which persisted searches may steer wording; omitted reads every source. */
const seedSources = ['search_console', 'search_intelligence', 'none'] as const;
/** Prompt cohorts a run can plan, core first so it wins ties. */
export const generationCohorts = ['core', 'brand_diagnostic', 'comparison'] as const;

export const generationInput = z.object({
  count: z
    .number()
    .int()
    .min(1)
    .default(() => generationSetting('default_count')),
  topic_ids: z.array(z.uuid()).default([]),
  topic_id: z.uuid().nullish(),
  agent_revision_id: z.uuid().nullish(),
  cohort: z.enum(generationCohorts).default('core'),
  /** A short note for this run only; reference data for drafting, never a business fact. */
  run_context: z.string().trim().max(G.run_context_max_chars).nullish(),
  distribution: generationDistribution.nullish(),
  seed_source: z.enum(seedSources).nullish(),
  seed_query_ids: z.array(z.uuid()).max(G.seed_query_ids_max).default([]),
});
export type GenerationInput = z.infer<typeof generationInput>;
export type GenerationCohort = GenerationInput['cohort'];
export const generationInvalid = (message: string) =>
  new ApiError(422, message, { code: 'generation_invalid' });
export const wantedTopics = (input: GenerationInput) => [
  ...new Set([...input.topic_ids, ...(input.topic_id ? [input.topic_id] : [])]),
];

/**
 * The cohort shares a run plans: a distribution's shares, else the whole run
 * in the requested cohort. Core takes what the branded shares leave.
 */
export function cohortShares(
  input: Pick<GenerationInput, 'cohort' | 'distribution'>,
): Record<GenerationCohort, number> {
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

/** Everything a request asked for that changes the run, in one canonical shape. */
export function requestKey(input: GenerationInput) {
  return JSON.stringify({
    count: input.count,
    cohort: input.cohort,
    agent_revision_id: input.agent_revision_id ?? null,
    topics: wantedTopics(input).toSorted(compareText),
    run_context: input.run_context || null,
    distribution: input.distribution
      ? { ...input.distribution, intent_mix: input.distribution.intent_mix ?? null }
      : null,
    seed_source: input.seed_source ?? null,
    seed_query_ids: input.seed_query_ids.toSorted(compareText),
  });
}

/** The request's own shape, checked before any read: no topics are needed. */
export function validateRequest(input: GenerationInput) {
  if (input.count > generationSetting('max_count'))
    throw generationInvalid('Requested count exceeds generation limit');
  if (wantedTopics(input).length > generationSetting('max_topic_ids'))
    throw generationInvalid('Too many topics selected');
  if (input.agent_revision_id && input.cohort !== 'core')
    throw generationInvalid('Agent portfolios require the core cohort');
  if (
    input.agent_revision_id &&
    (input.distribution || input.run_context || input.seed_source || input.seed_query_ids.length)
  )
    throw generationInvalid('Agent portfolios take no run context, distribution or seeds');
  if (input.distribution && input.cohort !== 'core')
    throw generationInvalid('A distribution plans its own cohorts; leave the cohort as core');
  if (input.seed_query_ids.length && (!input.seed_source || input.seed_source === 'none'))
    throw generationInvalid('Seed queries need their search data source');
}

/** The request's shape plus every selected topic belonging to the project's `topics`. */
export function validateSelection(input: GenerationInput, topics: readonly { id: string }[]) {
  validateRequest(input);
  if (wantedTopics(input).some((id) => !topics.some((topic) => topic.id === id)))
    throw generationInvalid('Selected topic is unavailable in this project');
}
