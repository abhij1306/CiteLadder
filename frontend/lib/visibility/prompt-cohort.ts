import type { UrlCodec } from '@/lib/navigation/url-state';

export const PROMPT_COHORTS = ['core', 'comparison', 'all'] as const;
export type PromptCohort = (typeof PROMPT_COHORTS)[number];

const storageKey = (projectId: string) => `citeladder.prompt-cohort.${projectId}`;

const isPromptCohort = (value: string | null): value is PromptCohort =>
  PROMPT_COHORTS.some((cohort) => cohort === value);

function readStoredCohort(projectId: string | null): PromptCohort {
  if (projectId === null || typeof window === 'undefined') return 'core';
  try {
    const stored = window.localStorage.getItem(storageKey(projectId));
    return isPromptCohort(stored) ? stored : 'core';
  } catch {
    return 'core';
  }
}

export function cohortUrlCodec(projectId: string | null): UrlCodec<PromptCohort> {
  return {
    parse: (raw) => (isPromptCohort(raw) ? raw : readStoredCohort(projectId)),
    serialize: (value) => value,
  };
}

export function writeStoredCohort(projectId: string | null, cohort: PromptCohort): void {
  if (projectId === null || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(projectId), cohort);
  } catch {
    // Private mode or quota: the choice stays in the URL for this visit.
  }
}
