import { useEffect, useMemo, useState } from 'react';

import type { TrailStep, RungStatus } from '@/components/ui/rung-trail';
import { useReducedMotion } from '@/lib/accessibility/use-reduced-motion';

const STEP_REVEAL_MS = 360;

function statusAt(index: number, done: number): RungStatus {
  if (index < done) return 'done';
  return index === done ? 'running' : 'pending';
}

function announcementFor(current: TrailStep | undefined, done: number): string {
  if (!current) return `${done} steps complete`;
  return `${current.label}. ${current.detail ?? ''}`;
}

export function useStaggeredSteps(
  steps: readonly TrailStep[],
  stagger: boolean,
): Readonly<{ steps: readonly TrailStep[]; done: number; announcement: string }> {
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
    return steps.map((step, index): TrailStep => {
      if (step.status === 'failed') return step;
      return { ...step, status: statusAt(index, shownDone) };
    });
  }, [animate, shownDone, steps, target]);

  const done = shown.filter((step) => step.status === 'done').length;
  const current = shown.find((step) => step.status === 'running' || step.status === 'failed');
  return { steps: shown, done, announcement: announcementFor(current, done) };
}
