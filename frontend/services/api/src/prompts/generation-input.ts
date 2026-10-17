import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { ApiError } from '../errors.ts';

export const generationSetting = (name: keyof typeof policy.prompts.generation_settings) =>
  Number(resolveSettingSpec(policy.prompts.generation_settings[name]));
export const generationInput = z.object({
  count: z
    .number()
    .int()
    .min(1)
    .default(() => generationSetting('default_count')),
  topic_ids: z.array(z.uuid()).default([]),
  topic_id: z.uuid().nullish(),
  agent_revision_id: z.uuid().nullish(),
  cohort: z.enum(['core', 'comparison', 'brand_diagnostic']).default('core'),
});
export type GenerationInput = z.infer<typeof generationInput>;
export const generationInvalid = (message: string) =>
  new ApiError(422, message, { code: 'generation_invalid' });
export const wantedTopics = (input: GenerationInput) => [
  ...new Set([...input.topic_ids, ...(input.topic_id ? [input.topic_id] : [])]),
];
export function validateSelection(input: GenerationInput, topics: readonly { id: string }[]) {
  const wanted = wantedTopics(input);
  if (input.count > generationSetting('max_count'))
    throw generationInvalid('Requested count exceeds generation limit');
  if (wanted.length > generationSetting('max_topic_ids'))
    throw generationInvalid('Too many topics selected');
  if (wanted.some((id) => !topics.some((topic) => topic.id === id)))
    throw generationInvalid('Selected topic is unavailable in this project');
  if (input.agent_revision_id && input.cohort !== 'core')
    throw generationInvalid('Agent portfolios require the core cohort');
}
