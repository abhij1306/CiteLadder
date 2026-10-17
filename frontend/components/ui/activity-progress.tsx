'use client';

import { CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useReducedMotion } from '@/lib/accessibility/use-reduced-motion';
import { cn } from '@/lib/utils';

type ActivityStepState = 'complete' | 'active' | 'pending' | 'attention';

export type ActivityStep = {
  id: string;
  label: string;
  detail?: string;
  state: ActivityStepState;
};

/**
 * The completion mark, drawn along its own stroke.
 *
 * Not lucide's `Check`: the draw needs `stroke-dasharray` on a path of known
 * length, and the icon's own path length is not ours to depend on. Three
 * points, 24 units long, matching the dash length `.activity-check` sets.
 */
function StepCheck() {
  return (
    <span className="activity-check text-success-text size-4">
      <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
        <path
          d="M3.5 8.5 L6.5 11.5 L12.5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function StepIndicator({ state }: Readonly<{ state: ActivityStepState }>) {
  if (state === 'complete') return <StepCheck />;
  if (state === 'attention') return <CircleAlert className="size-4" />;
  if (state === 'active') return <span className="activity-dot bg-info size-2" />;
  return <span className="bg-border-subtle size-1.5 rounded-full" />;
}

function progressAnnouncement(activeStep: ActivityStep | undefined, completed: number): string {
  if (!activeStep) return `${completed} steps complete`;
  return `${activeStep.label}. ${activeStep.detail ?? ''}`;
}

/**
 * A compact, factual timeline for background product work.
 *
 * Callers own the mapping from API phases to user language. This component
 * deliberately knows nothing about queue states or worker vocabulary, which
 * prevents an internal token from becoming fallback UI copy.
 */
/** Where one step sits relative to the animation's cursor. */
function stepStateAt(index: number, completed: number): 'complete' | 'active' | 'pending' {
  if (index < completed) return 'complete';
  return index === completed ? 'active' : 'pending';
}

export function ActivityProgress({
  steps,
  label,
  animateCompletion = false,
  appearance = 'default',
}: Readonly<{
  steps: ActivityStep[];
  label: string;
  /** Reveal fast persisted phase jumps one step at a time. */
  animateCompletion?: boolean;
  appearance?: 'default' | 'flow';
}>) {
  const targetCompleted = steps.filter((step) => step.state === 'complete').length;
  const [displayedCompleted, setDisplayedCompleted] = useState(
    animateCompletion ? 0 : targetCompleted,
  );
  const reduceMotion = useReducedMotion();
  const shouldAnimate = animateCompletion && !reduceMotion;

  useEffect(() => {
    if (!shouldAnimate) return;
    if (displayedCompleted > targetCompleted) {
      const resetTimer = window.setTimeout(() => setDisplayedCompleted(targetCompleted), 0);
      return () => window.clearTimeout(resetTimer);
    }
    if (displayedCompleted === targetCompleted) return;
    const timer = window.setTimeout(
      () => setDisplayedCompleted((current) => Math.min(current + 1, targetCompleted)),
      360,
    );
    return () => window.clearTimeout(timer);
  }, [displayedCompleted, shouldAnimate, targetCompleted]);

  const renderedSteps = useMemo(() => {
    if (!shouldAnimate || displayedCompleted >= targetCompleted) return steps;
    return steps.map((step, index): ActivityStep => {
      if (step.state === 'attention') return step;
      return { ...step, state: stepStateAt(index, displayedCompleted) };
    });
  }, [displayedCompleted, shouldAnimate, steps, targetCompleted]);

  const completed = renderedSteps.filter((step) => step.state === 'complete').length;
  const activeStep = renderedSteps.find(
    (step) => step.state === 'active' || step.state === 'attention',
  );
  const progressLabel = `${completed} of ${steps.length} steps complete`;

  if (appearance === 'flow') {
    return (
      <section aria-label={label} className="flow-activity grid">
        <progress
          className="sr-only"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
          value={completed}
          max={Math.max(renderedSteps.length, 1)}
        />
        <ol className="flow-activity-list list-none p-0">
          {renderedSteps.map((step) => (
            <li key={step.id} className="flow-activity-row" data-state={step.state}>
              <span className="flow-activity-indicator" aria-hidden>
                <StepIndicator state={step.state} />
              </span>
              <p className="flow-help">{step.label}</p>
              {step.detail ? <p className="flow-meta">{step.detail}</p> : null}
            </li>
          ))}
        </ol>
        <span className="sr-only" aria-live="polite">
          {progressAnnouncement(activeStep, completed)}
        </span>
      </section>
    );
  }

  return (
    <section aria-label={label} className="grid gap-4">
      <progress
        className="bg-neutral-bg [&::-webkit-progress-bar]:bg-neutral-bg [&::-webkit-progress-value]:bg-info [&::-moz-progress-bar]:bg-info h-1.5 w-full appearance-none overflow-hidden rounded-full border-0"
        aria-label={progressLabel}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={completed}
        value={completed}
        max={Math.max(renderedSteps.length, 1)}
      />

      <ol className="grid list-none gap-0 p-0">
        {renderedSteps.map((step, index) => (
          <li key={step.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
            <div className="flex flex-col items-center" aria-hidden>
              <span
                className={cn(
                  'relative z-1 flex size-6 shrink-0 items-center justify-center rounded-full',
                  step.state === 'complete' && 'bg-success-bg text-success-text',
                  step.state === 'active' && 'bg-info-bg text-info-text',
                  step.state === 'attention' && 'bg-warning-bg text-warning-text',
                  step.state === 'pending' && 'border-border bg-panel text-muted border',
                )}
              >
                <StepIndicator state={step.state} />
              </span>
              {index < renderedSteps.length - 1 ? (
                <span className="bg-border-subtle min-h-5 w-px flex-1" />
              ) : null}
            </div>

            <div className={cn('min-w-0 pb-4', index === renderedSteps.length - 1 && 'pb-0')}>
              <p className={cn('type-item-title', step.state === 'pending' && 'text-muted')}>
                {step.label}
              </p>
              {step.detail ? <p className="type-caption mt-0.5">{step.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      <span className="sr-only" aria-live="polite">
        {progressAnnouncement(activeStep, completed)}
      </span>
    </section>
  );
}
