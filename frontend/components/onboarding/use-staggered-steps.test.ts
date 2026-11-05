import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Step } from '@/components/ui/step-list';

import { useStaggeredSteps } from './use-staggered-steps';

const PERSISTED: Step[] = [
  { id: 'open', label: 'Opened your website', detail: '3 pages read', status: 'done' },
  { id: 'read', label: 'Reading what you offer', status: 'done' },
  { id: 'find', label: 'Found comparable brands', detail: '2 brands found', status: 'done' },
  { id: 'prepare', label: 'Preparing your review', status: 'running' },
];

function statuses(steps: readonly Step[]) {
  return steps.map((step) => step.status);
}

describe('useStaggeredSteps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reveals a persisted jump one step every 360ms and announces the step in progress', () => {
    const { result } = renderHook(() => useStaggeredSteps(PERSISTED, true));

    expect(statuses(result.current.steps)).toEqual(['running', 'pending', 'pending', 'pending']);
    expect(result.current.done).toBe(0);
    expect(result.current.announcement).toBe('Opened your website. 3 pages read');

    act(() => vi.advanceTimersByTime(360));
    expect(statuses(result.current.steps)).toEqual(['done', 'running', 'pending', 'pending']);
    expect(result.current.announcement).toBe('Reading what you offer. ');

    act(() => vi.advanceTimersByTime(360));
    act(() => vi.advanceTimersByTime(360));
    expect(statuses(result.current.steps)).toEqual(['done', 'done', 'done', 'running']);
    expect(result.current.done).toBe(3);
    expect(result.current.announcement).toBe('Preparing your review. ');
  });

  it('shows persisted steps at once without the stagger', () => {
    const { result } = renderHook(() => useStaggeredSteps(PERSISTED, false));

    expect(statuses(result.current.steps)).toEqual(['done', 'done', 'done', 'running']);
    expect(result.current.done).toBe(3);
  });

  it('shows persisted steps at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { result } = renderHook(() => useStaggeredSteps(PERSISTED, true));

    expect(statuses(result.current.steps)).toEqual(['done', 'done', 'done', 'running']);
  });

  it('never hides a failed step behind the reveal', () => {
    const steps: Step[] = [
      { id: 'open', label: 'Opened your website', status: 'done' },
      {
        id: 'read',
        label: 'Reading what you offer',
        detail: 'Check the address and try again.',
        status: 'failed',
      },
    ];
    const { result } = renderHook(() => useStaggeredSteps(steps, true));

    expect(statuses(result.current.steps)).toEqual(['running', 'failed']);
  });

  it('counts completed steps when nothing is in progress', () => {
    const steps: Step[] = [
      { id: 'save', label: 'Saving your project', status: 'done' },
      { id: 'open', label: 'Opening your workspace', status: 'done' },
    ];
    const { result } = renderHook(() => useStaggeredSteps(steps, false));

    expect(result.current.announcement).toBe('2 steps complete');
  });
});
