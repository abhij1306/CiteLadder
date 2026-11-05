'use client';

import { useEffect, useMemo, useState } from 'react';

import type { Step, StepStatus } from '@/components/ui/step-list';
import { useReducedMotion } from '@/lib/accessibility/use-reduced-motion';

/** How long each revealed step holds before the next one completes. */
const STEP_REVEAL_MS = 360;

/** Where one step sits relative to the reveal's cursor. */
function statusAt(index: number, done: number): StepStatus {
  if (index < done) return 'done';
  return index === done ? 'running' : 'pending';
}

function announcementFor(current: Step | undefined, done: number): string {
  if (!current) return `${done} steps complete`;
  return `${current.label}. ${current.detail ?? ''}`;
}

/**
 * Onboarding's persisted phases can jump several steps between two polls.
 * With `stagger`, the jump is revealed one step every 360ms instead (at once
 * under reduced motion), and the step being worked on is what a screen reader
 * hears politely. A failed step is never hidden by the reveal.
 */
export function useStaggeredSteps(
  steps: readonly Step[],
  stagger: boolean,
): Readonly<{ steps: readonly Step[]; done: number; announcement: string }> {
  const target = steps.filter((step) => step.status === 'done').length;
  const [shownDone, setShownDone] = useState(stagger ? 0 : target);
  const reduceMotion = useReducedMotion();
  const animate = stagger && !reduceMotion;

  useEffect(() => {
    if (!animate) return;
    if (shownDone > target) {
      const resetTimer = window.setTimeout(() => setShownDone(target), 0);
      return () => window.clearTimeout(resetTimer);
    }
    if (shownDone === target) return;
    const timer = window.setTimeout(
      () => setShownDone((current) => Math.min(current + 1, target)),
      STEP_REVEAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [animate, shownDone, target]);

  const shown = useMemo(() => {
    if (!animate || shownDone >= target) return steps;
    return steps.map((step, index): Step => {
      if (step.status === 'failed') return step;
      return { ...step, status: statusAt(index, shownDone) };
    });
  }, [animate, shownDone, steps, target]);

  const done = shown.filter((step) => step.status === 'done').length;
  const current = shown.find((step) => step.status === 'running' || step.status === 'failed');
  return { steps: shown, done, announcement: announcementFor(current, done) };
}
