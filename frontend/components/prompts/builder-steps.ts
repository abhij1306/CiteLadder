import { stringUrlCodec } from '@/lib/navigation/url-state';
import type { GenerationMode } from '@/lib/prompts/builder-run';
import { BUILDER_STEP_PARAM, PROMPT_BUILDER_HREF } from '@/lib/prompts/routes';

export type BuilderStep = 'business' | 'topics' | 'distribution' | 'review';

export const BUILDER_STEPS = [
  { value: 'business', label: 'About your business' },
  { value: 'topics', label: 'Topics' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'review', label: 'Review' },
] as const satisfies readonly { value: BuilderStep; label: string }[];

export const builderStepCodec = stringUrlCodec<BuilderStep>(
  BUILDER_STEPS.map((step) => step.value),
  'business',
);

export const builderModeCodec = stringUrlCodec<GenerationMode>(['market', 'brand'], 'market');

export const liveBuilderStep = (): BuilderStep | null =>
  window.location.pathname === PROMPT_BUILDER_HREF
    ? builderStepCodec.parse(new URLSearchParams(window.location.search).get(BUILDER_STEP_PARAM))
    : null;
