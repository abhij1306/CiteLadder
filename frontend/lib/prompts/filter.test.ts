import { describe, expect, it } from 'vite-plus/test';

import type { Prompt } from '@/lib/api/types';
import { emptyFilters, filterPrompts } from './filter';

function prompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    prompt_set_id: '22222222-2222-4222-8222-222222222222',
    text: 'Best running shoes?',
    theme: 'Comfort',
    intent: 'discovery',
    buyer_stage: '',
    prompt_intent: '',
    persona: '',
    cohort: 'core',
    branded: false,
    enabled: true,
    origin: 'manual',
    status: 'active',
    ...overrides,
  };
}

const prompts: Prompt[] = [
  prompt({
    id: 'a',
    text: 'Best running shoes?',
    intent: 'discovery',
    enabled: true,
    branded: false,
  }),
  prompt({
    id: 'b',
    text: 'Nike vs Adidas',
    intent: 'comparison',
    enabled: false,
    branded: true,
    theme: 'Rivals',
  }),
  prompt({
    id: 'c',
    text: 'Where to buy trainers',
    intent: 'purchase',
    enabled: true,
    branded: false,
    theme: '',
  }),
];

describe('filterPrompts', () => {
  it('returns all prompts with empty search and filters', () => {
    expect(filterPrompts(prompts, '', emptyFilters)).toHaveLength(3);
  });

  it('searches text and theme case-insensitively', () => {
    expect(filterPrompts(prompts, 'nike', emptyFilters).map((p) => p.id)).toEqual(['b']);
    expect(filterPrompts(prompts, 'comfort', emptyFilters).map((p) => p.id)).toEqual(['a']);
  });

  it('filters by intent', () => {
    const result = filterPrompts(prompts, '', {
      ...emptyFilters,
      intents: ['comparison', 'purchase'],
    });
    expect(result.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('filters by buyer stage, leaving prompts without one out of a stage filter', () => {
    const staged = [
      ...prompts,
      prompt({ id: 'd', text: 'Which trainers last longest', buyer_stage: 'decision' }),
      prompt({ id: 'e', text: 'Do I need trainers', buyer_stage: 'awareness' }),
    ];
    const result = filterPrompts(staged, '', { ...emptyFilters, stages: ['decision'] });
    expect(result.map((p) => p.id)).toEqual(['d']);
  });

  it('filters by enabled tri-state', () => {
    expect(
      filterPrompts(prompts, '', { ...emptyFilters, enabled: 'enabled' }).map((p) => p.id),
    ).toEqual(['a', 'c']);
    expect(
      filterPrompts(prompts, '', { ...emptyFilters, enabled: 'disabled' }).map((p) => p.id),
    ).toEqual(['b']);
  });

  it('filters by branded tri-state', () => {
    expect(
      filterPrompts(prompts, '', { ...emptyFilters, branded: 'enabled' }).map((p) => p.id),
    ).toEqual(['b']);
  });
});
