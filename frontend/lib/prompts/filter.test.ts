import { describe, expect, it } from 'vite-plus/test';

import type { Prompt } from '@citeladder/contracts';
import {
  brandOptions,
  emptyFilters,
  filterPrompts,
  leadingSources,
  sourceOptions,
  type PromptFilters,
  type PromptMentions,
} from './filter';

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
  const ids = (
    search: string,
    filters: Partial<PromptFilters>,
    list: Prompt[] = prompts,
    mentions?: ReadonlyMap<string, PromptMentions>,
  ) =>
    filterPrompts({
      prompts: list,
      search,
      filters: { ...emptyFilters, ...filters },
      mentions,
    }).map((p) => p.id);

  it('returns all prompts with empty search and filters', () => {
    expect(ids('', {})).toEqual(['a', 'b', 'c']);
  });

  it('searches text and theme case-insensitively', () => {
    expect(ids('nike', {})).toEqual(['b']);
    expect(ids('comfort', {})).toEqual(['a']);
  });

  it('filters by intent', () => {
    expect(ids('', { intents: ['comparison', 'purchase'] })).toEqual(['b', 'c']);
  });

  it('filters by buyer stage, leaving prompts without one out of a stage filter', () => {
    const staged = [
      ...prompts,
      prompt({ id: 'd', text: 'Which trainers last longest', buyer_stage: 'decision' }),
      prompt({ id: 'e', text: 'Do I need trainers', buyer_stage: 'awareness' }),
    ];
    expect(ids('', { stages: ['decision'] }, staged)).toEqual(['d']);
  });

  it('filters by enabled tri-state', () => {
    expect(ids('', { enabled: 'enabled' })).toEqual(['a', 'c']);
    expect(ids('', { enabled: 'disabled' })).toEqual(['b']);
  });

  it('filters by branded tri-state', () => {
    expect(ids('', { branded: 'enabled' })).toEqual(['b']);
  });

  const mentions = new Map<string, PromptMentions>([
    [
      'a',
      {
        named: [{ kind: 'brand', name: 'Old Name' }],
        sources: [{ domain: 'g2.com', citations: 2, owned: false }],
      },
    ],
    [
      'b',
      {
        named: [{ kind: 'competitor', name: '  Rival   Co ' }],
        sources: [
          { domain: 'acme.com', citations: 1, owned: true },
          { domain: 'g2.com', citations: 1, owned: false },
        ],
      },
    ],
  ]);

  it('keeps prompts whose answers named any selected brand', () => {
    const project = {
      brand_name: 'Acme',
      competitors: [{ name: 'Rival Co' }, { name: 'rival co' }],
    };
    const [brand, rival] = brandOptions(project);
    expect(brandOptions(project)).toEqual([
      { value: 'brand', label: 'Acme' },
      { value: 'competitor:rival co', label: 'Rival Co' },
    ]);
    expect(ids('', { brands: [brand!.value] }, prompts, mentions)).toEqual(['a']);
    expect(ids('', { brands: [rival!.value] }, prompts, mentions)).toEqual(['b']);
    expect(ids('', { brands: [brand!.value, rival!.value] }, prompts, mentions)).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps prompts whose answers cited any selected domain', () => {
    expect(ids('', { sources: ['acme.com'] }, prompts, mentions)).toEqual(['b']);
    expect(ids('', { sources: ['g2.com'] }, prompts, mentions)).toEqual(['a', 'b']);
    expect(ids('', { sources: ['g2.com'], brands: ['brand'] }, prompts, mentions)).toEqual(['a']);
    expect(ids('', { sources: ['g2.com'] })).toEqual([]);
  });
});

describe('sourceOptions', () => {
  it('lists every cited domain by total citations, then name, marking your own', () => {
    expect(
      sourceOptions([
        { named: [], sources: [{ domain: 'zeta.com', citations: 2, owned: false }] },
        {
          named: [],
          sources: [
            { domain: 'acme.com', citations: 2, owned: true },
            { domain: 'zeta.com', citations: 1, owned: false },
            { domain: 'beta.com', citations: 2, owned: false },
          ],
        },
      ]),
    ).toEqual([
      { value: 'zeta.com', label: 'zeta.com' },
      { value: 'acme.com', label: 'acme.com (yours)' },
      { value: 'beta.com', label: 'beta.com' },
    ]);
  });

  it('keeps a selected domain no longer cited last, so it can be cleared', () => {
    const cited = [{ named: [], sources: [{ domain: 'g2.com', citations: 1, owned: false }] }];
    expect(sourceOptions(cited, ['gone.com', 'g2.com'])).toEqual([
      { value: 'g2.com', label: 'g2.com' },
      { value: 'gone.com', label: 'gone.com' },
    ]);
  });
});

describe('leadingSources', () => {
  const domain = (name: string) => ({ domain: name, citations: 1, owned: false });

  it('shows the first three cited domains and counts the rest', () => {
    const sources = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'].map(domain);
    expect(leadingSources(sources)).toEqual({ shown: sources.slice(0, 3), more: 2 });
    expect(leadingSources(sources.slice(0, 2))).toEqual({ shown: sources.slice(0, 2), more: 0 });
  });
});
