/**
 * Prompt search + filter model. Pure functions so the toolbar stays
 * presentational and filtering is unit-testable.
 */
import type { Prompt } from '@/lib/api/types';

/** Tri-state for the enabled / branded filters. */
export type EnabledFilter = 'all' | 'enabled' | 'disabled';

export type PromptFilters = {
  /** Selected intents (empty = all intents). */
  intents: string[];
  /** Selected buyer stages (empty = all stages). */
  stages: string[];
  /** Selected personas (empty = all personas). */
  personas: string[];
  enabled: EnabledFilter;
  branded: EnabledFilter;
};

export const emptyFilters: PromptFilters = {
  intents: [],
  stages: [],
  personas: [],
  enabled: 'all',
  branded: 'all',
};

/** The personas the library uses, for the filter menu; untagged prompts add none. */
export function personaOptions(prompts: readonly Prompt[]): string[] {
  return [...new Set(prompts.map((prompt) => prompt.persona).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function matchesTriState(value: boolean, filter: EnabledFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'enabled' ? value : !value;
}

/** Apply search + filters to a prompt list, preserving order. */
export function filterPrompts(prompts: Prompt[], search: string, filters: PromptFilters): Prompt[] {
  const needle = search.trim().toLowerCase();
  const intentSet = new Set(filters.intents);
  const stageSet = new Set(filters.stages);
  const personaSet = new Set(filters.personas);
  return prompts.filter((prompt) => {
    if (needle) {
      const haystack = `${prompt.text} ${prompt.theme ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (intentSet.size > 0 && !intentSet.has(prompt.intent)) return false;
    if (stageSet.size > 0 && !stageSet.has(prompt.buyer_stage)) return false;
    if (personaSet.size > 0 && !personaSet.has(prompt.persona)) return false;
    if (!matchesTriState(prompt.enabled, filters.enabled)) return false;
    if (!matchesTriState(prompt.branded, filters.branded)) return false;
    return true;
  });
}
