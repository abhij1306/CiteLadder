import { describe, expect, it } from 'vitest';

import { canMeasure } from '../src/audits/freeze.ts';
import { taskFunding } from '../src/audits/prompt-runs.ts';
import { policy } from '../src/config.ts';
import {
  covering,
  mapKnownFor,
  mapObjections,
  mapThemeBrands,
  themeOutput,
} from '../src/probes/label-model.ts';
import { rankInTopTheme } from '../src/probes/market.ts';
import { probeQuestions } from '../src/probes/questions.ts';
import { distinctPlaces, firstPlaces, positionScores, rankOf } from '../src/probes/scores.ts';

const answers = [1, 2, 3].map((n) => ({ taskId: `task-${n}`, text: `answer ${n}` }));

describe('position score', () => {
  it('scores 100 first, minus 10 per later place, 0 when not raised, averaged over every answer', () => {
    const scores = positionScores([
      distinctPlaces([
        { key: 'price', rank: 0 },
        { key: 'fit', rank: 1 },
      ]),
      distinctPlaces([{ key: 'price', rank: 0 }]),
      distinctPlaces([
        { key: 'fit', rank: 0 },
        { key: 'price', rank: 1 },
        { key: 'late', rank: 12 },
      ]),
    ]);
    expect(Object.fromEntries(scores)).toEqual({
      price: { score: 97, raised: 3 },
      fit: { score: 63, raised: 2 },
      late: { score: 27, raised: 1 },
    });
  });

  it('places distinct keys in answer order, so repeats never push later ones down', () => {
    const places = distinctPlaces([
      { key: 'comfort', rank: 2 },
      { key: 'price', rank: 0 },
      { key: 'price', rank: 1 },
    ]);
    expect([...places]).toEqual([
      ['price', 0],
      ['comfort', 1],
    ]);
    expect([
      ...firstPlaces([
        { key: 'rival', rank: 3 },
        { key: 'rival', rank: 1 },
      ]),
    ]).toEqual([['rival', 1]]);
  });

  it('ranks by strictly higher scores, so ties share a rank', () => {
    const entries = [
      { key: 'brand', score: 60 },
      { key: 'a', score: 90 },
      { key: 'b', score: 60 },
    ];
    expect([rankOf(entries, 'brand'), rankOf(entries, 'b'), rankOf(entries, 'a')]).toEqual([
      2, 2, 1,
    ]);
  });
});

describe('rank in top theme', () => {
  const themeId = '0f3b1c9e-0000-4000-8000-0000000000c1';
  const roster = [
    { kind: 'brand' as const, id: null, name: 'Acme', aliases: [] },
    { kind: 'competitor' as const, id: 'rival', name: 'Rival', aliases: [] },
  ];
  const asked = (brandNamed: number) =>
    Array.from({ length: 21 }, (_, n) => ({
      taskId: `task-${n}`,
      engine: 'chatgpt' as const,
      question: { question: 'theme' as const, theme_id: themeId, theme_name: 'Comfort' },
      items: [{ id: 'rival', rank: 0 }, ...(n < brandNamed ? [{ id: null, rank: 9 }] : [])].map(
        ({ id, rank }) => ({
          question: 'theme',
          rank,
          theme_id: null,
          objection_group_id: null,
          entity_kind: id ? 'competitor' : 'brand',
          entity_id: id,
        }),
      ),
    }));
  const top = [{ theme_id: themeId, theme: 'Comfort', score: 50 }];

  it('ranks a brand named once even when its averaged score rounds to 0', () => {
    expect(rankInTopTheme(asked(1), top, roster)).toEqual({ kind: 'rank', rank: 2 });
    expect(rankInTopTheme(asked(0), top, roster)).toEqual({ kind: 'not_named' });
  });
});

describe('probe market coverage', () => {
  it('skips an engine that cannot measure a market instead of failing it', () => {
    const brazil = {
      id: '0f3b1c9e-0000-4000-8000-0000000000b2',
      country_code: 'BR',
      language_code: 'pt',
    };
    const home = { id: null, country_code: 'BR', language_code: 'pt' };
    expect(
      (['chatgpt', 'chatgpt_search', 'gemini_consumer', 'gemini'] as const).map((engine) => [
        canMeasure(engine, brazil),
        canMeasure(engine, home),
      ]),
    ).toEqual([
      [true, true],
      [true, true],
      // The Gemini app has no Portuguese search; the Gemini API cannot leave the default market.
      [false, false],
      [false, true],
    ]);
  });
});

describe('probe questions and funding', () => {
  it('asks two brand questions and one per theme naming the category and market', () => {
    const asked = probeQuestions({
      brand: 'Best&Less',
      category: 'discount clothing',
      country: 'Australia',
      themes: [{ id: '0f3b1c9e-0000-4000-8000-000000000001', name: 'Low Prices' }],
    });
    expect(
      asked.map(({ text, cohort, generation_evidence }) => [text, cohort, generation_evidence]),
    ).toEqual([
      ['What is Best&Less known for?', 'probe', { probe: { question: 'known_for' } }],
      ['Why might someone not choose Best&Less?', 'probe', { probe: { question: 'objection' } }],
      [
        'Which discount clothing brands in Australia are best known for low prices?',
        'probe',
        {
          probe: {
            question: 'theme',
            theme_id: '0f3b1c9e-0000-4000-8000-000000000001',
            theme_name: 'Low Prices',
          },
        },
      ],
    ]);
  });

  it("charges a probe answer in AI credits: labelling only on the customer's key", () => {
    const label = policy.probes.label_credits;
    const answer = policy.probes.answer_credits.claude!;
    expect([
      taskFunding('probe', 'claude', true),
      taskFunding('probe', 'claude', false),
      taskFunding('brand', 'claude', false),
    ]).toEqual([
      { capability: 'ai_credits', units: label },
      { capability: 'ai_credits', units: label + answer },
      { capability: 'prompt_runs_per_period', units: 1 },
    ]);
  });
});

describe('labelling output mapping', () => {
  it("maps known-for points onto the project's themes, case and spacing aside, else Other", () => {
    const themes = [{ id: 'theme-comfort', name: 'All-day  Comfort' }];
    const items = mapKnownFor(
      {
        answers: [
          {
            answer: 1,
            points: [
              { theme: 'all-day comfort', quote: 'q' },
              { theme: 'Funding', quote: '' },
            ],
          },
          { answer: 9, points: [{ theme: 'All-day Comfort', quote: '' }] },
          { answer: 1, points: [{ theme: 'All-day Comfort', quote: '' }] },
        ],
      },
      answers,
      { themes, maxItems: 10 },
    );
    expect(items).toEqual([
      { taskId: 'task-1', rank: 0, themeId: 'theme-comfort', quote: 'q' },
      { taskId: 'task-1', rank: 1, themeId: null, quote: '' },
    ]);
  });

  it('refuses a labelling reply that skips an answer, but keeps an answer listed with nothing', () => {
    const schema = covering(themeOutput, 2);
    const reply = (numbers: number[]) =>
      schema.safeParse({ answers: numbers.map((answer) => ({ answer, brands: [] })) }).success;
    expect([reply([1]), reply([2, 9]), reply([2, 1])]).toEqual([false, false, true]);
  });

  it("maps a later market's reasons onto the groups an earlier one named, inside the same cap", () => {
    const mapped = mapObjections(
      {
        answers: [
          {
            answer: 1,
            reasons: [
              { group: 'slow  delivery', quote: '' },
              { group: 'Weak returns', quote: '' },
            ],
          },
        ],
      },
      answers,
      { groups: [], named: ['Slow delivery'], maxItems: 10, maxNewGroups: 1, nameMaxChars: 120 },
    );
    expect(mapped).toEqual({
      items: [
        { taskId: 'task-1', rank: 0, group: { kind: 'new', name: 'Slow delivery' }, quote: '' },
      ],
      newGroups: ['Slow delivery'],
    });
  });

  it('maps reasons onto existing groups and creates a group only for a new name, capped per probe', () => {
    const mapped = mapObjections(
      {
        answers: [
          {
            answer: 1,
            reasons: [
              { group: 'too EXPENSIVE', quote: '' },
              { group: 'Slow delivery', quote: '' },
              { group: 'slow  delivery', quote: '' },
              { group: 'Weak returns', quote: '' },
            ],
          },
        ],
      },
      answers,
      {
        groups: [{ id: 'group-price', name: 'Too expensive' }],
        maxItems: 10,
        maxNewGroups: 1,
        nameMaxChars: 120,
      },
    );
    expect(mapped).toEqual({
      items: [
        { taskId: 'task-1', rank: 0, group: { kind: 'existing', id: 'group-price' }, quote: '' },
        { taskId: 'task-1', rank: 1, group: { kind: 'new', name: 'Slow delivery' }, quote: '' },
        { taskId: 'task-1', rank: 2, group: { kind: 'new', name: 'Slow delivery' }, quote: '' },
      ],
      newGroups: ['Slow delivery'],
    });
  });

  it('finds tracked businesses in a theme answer through their aliases, at their listed place', () => {
    const tracked = [
      { kind: 'brand' as const, id: null, name: 'Best&Less', aliases: [] },
      { kind: 'competitor' as const, id: 'rival', name: 'Kmart', aliases: ['Kmart Australia'] },
    ];
    const items = mapThemeBrands(
      { answers: [{ answer: 2, brands: ['Kmart Australia', 'Target', 'Best and Less', 'Kmart'] }] },
      answers,
      { tracked, maxItems: 10 },
    );
    expect(items.map(({ taskId, rank, entity }) => [taskId, rank, entity.name])).toEqual([
      ['task-2', 0, 'Kmart'],
      ['task-2', 2, 'Best&Less'],
    ]);
  });
});
