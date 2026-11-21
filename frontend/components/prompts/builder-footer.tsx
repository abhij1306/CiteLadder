import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProjectLink } from '@/components/ui/project-link';
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from '@/lib/icons';
import { pluralCount } from '@/lib/format';
import { PROMPTS_HREF } from '@/lib/prompts/routes';

import { liveBuilderStep, type BuilderStep } from './builder-steps';
import type { BusinessDraftState } from '@/components/knowledge-base/use-business-draft';
import type { BuilderTopics } from './use-builder-topics';

export function BuilderCancel() {
  return (
    <Button asChild variant="quiet">
      <ProjectLink href={PROMPTS_HREF}>
        <Icon icon={X} />
        Cancel
      </ProjectLink>
    </Button>
  );
}

export function BuilderStepActions({
  step,
  setStep,
  business,
  topics,
  canGenerate,
  isGenerating,
  onGenerate,
  track,
}: Readonly<{
  step: BuilderStep;
  setStep: (step: BuilderStep) => void;
  business: BusinessDraftState;
  topics: BuilderTopics;
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  track: { count: number; disabled: boolean; onTrack: () => void };
}>): ReactNode {
  const back = (to: BuilderStep) => (
    <Button variant="quiet" onClick={() => setStep(to)}>
      <Icon icon={ArrowLeft} />
      Back
    </Button>
  );
  const advance = async (save: () => Promise<unknown>, to: BuilderStep) => {
    try {
      await save();
      if (liveBuilderStep() === step) setStep(to);
    } catch {}
  };
  switch (step) {
    case 'business':
      return (
        <Button
          variant="primary"
          disabled={!business.draft}
          pending={business.save.isPending}
          pendingLabel="Saving…"
          onClick={() =>
            void advance(
              () => (business.dirty ? business.save.mutateAsync() : Promise.resolve()),
              'topics',
            )
          }
        >
          Next
          <Icon icon={ArrowRight} />
        </Button>
      );
    case 'topics':
      return (
        <>
          {back('business')}
          <Button
            variant="primary"
            disabled={topics.problem !== null || topics.preview.isPending}
            pending={topics.confirm.isPending}
            pendingLabel="Confirming…"
            onClick={() =>
              void advance(
                () => (topics.pending ? topics.confirm.mutateAsync() : Promise.resolve()),
                'distribution',
              )
            }
          >
            {topics.pending ? 'Confirm topics' : 'Next'}
            <Icon icon={topics.pending ? Check : ArrowRight} />
          </Button>
        </>
      );
    case 'distribution':
      return (
        <>
          {back('topics')}
          <Button
            variant="primary"
            disabled={!canGenerate}
            pending={isGenerating}
            pendingLabel="Generating…"
            onClick={onGenerate}
          >
            <Icon icon={Sparkles} />
            Generate
          </Button>
        </>
      );
    case 'review':
      return (
        <>
          {back('distribution')}
          <Button variant="primary" disabled={track.disabled} onClick={track.onTrack}>
            <Icon icon={Check} />
            Track {pluralCount(track.count, 'prompt')}
          </Button>
        </>
      );
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}
