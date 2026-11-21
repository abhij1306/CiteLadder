import { describe, expect, it } from 'vite-plus/test';

import type { ProbeMarketValue, ProbeObjectionsValue } from '@citeladder/contracts/probes';

import { marketSummary, objectionsSummary } from './probe';

const probe = {
  launch_id: '00000000-0000-4000-8000-000000000001',
  created_at: '2026-11-12T00:00:00Z',
  engines: ['chatgpt', 'claude'],
  markets: [{ id: null, country_code: 'US', language_code: 'en' }],
  answers: 12,
} satisfies ProbeMarketValue['probe'];

const brand = { kind: 'brand', id: null, name: 'Acme' } as const;
const rival = {
  kind: 'competitor',
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Rival',
} as const;

function theme(
  id: string,
  name: string,
  own: number,
  other: number,
  ownNamed = own > 0,
): ProbeMarketValue['themes'][number] {
  const ownFirst = own >= other;
  return {
    theme_id: `00000000-0000-4000-8000-00000000000${id}`,
    theme: name,
    entities: [
      { ...brand, score: own, named: ownNamed },
      { ...rival, score: other, named: other > 0 },
    ],
    rank: ownFirst ? 1 : 2,
    of: 2,
    leader: ownFirst
      ? { ...brand, score: own, named: ownNamed }
      : { ...rival, score: other, named: other > 0 },
    gap: ownFirst ? 0 : other - own,
  };
}

function market(themes: ProbeMarketValue['themes'], knownFor: string[]): ProbeMarketValue {
  return {
    state: 'value',
    probe,
    brand: 'Acme',
    category: 'Shoes',
    language_code: 'en',
    known_for_answers: 6,
    known_for: knownFor.map((name, index) => ({
      theme_id: themes.find((row) => row.theme === name)?.theme_id ?? null,
      theme: name,
      score: 90 - index * 10,
    })),
    themes,
    engines: [],
  };
}

describe('marketSummary', () => {
  it.each([
    {
      name: 'top theme is also the one the brand leads',
      themes: [theme('1', 'Comfort', 80, 40), theme('2', 'Price', 20, 90)],
      knownFor: ['Comfort', 'Price'],
      headline: 'AI describes Acme as Comfort, and that is also where it competes best',
      led: ['Comfort'],
      gap: 'Price',
      topRank: 1,
    },
    {
      name: 'leads another theme than the top one',
      themes: [theme('1', 'Comfort', 30, 60), theme('2', 'Price', 70, 10)],
      knownFor: ['Other', 'Comfort'],
      headline: 'AI describes Acme as Comfort, and it competes best on Price',
      led: ['Price'],
      gap: 'Comfort',
      topRank: 2,
    },
    {
      name: 'a zero tie is not a lead',
      themes: [theme('1', 'Comfort', 0, 0)],
      knownFor: ['Comfort'],
      headline: 'AI describes Acme as Comfort',
      led: [],
      gap: undefined,
      topRank: undefined,
    },
    {
      name: 'a brand named late enough to score 0 still ranks',
      themes: [theme('1', 'Comfort', 0, 50, true)],
      knownFor: ['Comfort'],
      headline: 'AI describes Acme as Comfort',
      led: [],
      gap: 'Comfort',
      topRank: 2,
    },
    {
      name: 'only Other raised',
      themes: [theme('1', 'Comfort', 0, 50)],
      knownFor: ['Other'],
      headline: 'How AI describes Acme',
      led: [],
      gap: 'Comfort',
      topRank: undefined,
    },
  ])('$name', ({ themes, knownFor, headline, led, gap, topRank }) => {
    const summary = marketSummary(market(themes, knownFor));
    expect(summary.headline).toBe(headline);
    expect(summary.led.map((row) => row.theme)).toEqual(led);
    expect(summary.biggestGap?.theme).toBe(gap);
    expect(summary.topRow?.rank).toBe(topRank);
  });
});

function group(
  name: string,
  score: number | null,
  engines: ProbeObjectionsValue['probe']['engines'],
) {
  return {
    id: `00000000-0000-4000-8000-0000000000${name.length}0`,
    name,
    score,
    engines,
    history: [score],
    sources: 0,
    pages: [],
  };
}

describe('objectionsSummary', () => {
  it('counts raised groups and the widest one', () => {
    const summary = objectionsSummary({
      state: 'value',
      probe,
      brand: 'Acme',
      answers: 6,
      answered_by: ['chatgpt', 'claude'],
      average: 68,
      groups: [
        group('Too expensive', 90, ['chatgpt']),
        group('Slow delivery', 45, ['chatgpt', 'claude']),
        group('Fit', 0, []),
      ],
    });
    expect(summary).toMatchObject({
      headline: 'Too expensive is the objection AI raises first',
      widest: { name: 'Slow delivery' },
    });
    expect(summary.raised.map((item) => item.name)).toEqual(['Too expensive', 'Slow delivery']);
  });

  it('names no objection when none was raised', () => {
    const summary = objectionsSummary({
      state: 'value',
      probe,
      brand: 'Acme',
      answers: 6,
      answered_by: ['chatgpt', 'claude'],
      average: null,
      groups: [group('Fit', 0, [])],
    });
    expect(summary).toMatchObject({
      headline: 'AI raises no objections to Acme',
      widest: undefined,
    });
  });

  it('keeps an objection an engine raised even when its average rounds to 0', () => {
    const summary = objectionsSummary({
      state: 'value',
      probe,
      brand: 'Acme',
      answers: 30,
      answered_by: ['chatgpt', 'claude'],
      average: 0,
      groups: [group('Fit', 0, ['claude']), group('Slow', 0, [])],
    });
    expect(summary.raised.map((item) => item.name)).toEqual(['Fit']);
    expect(summary.headline).toBe('Fit is the objection AI raises first');
  });

  it('says no engine answered when the probe has no objection answers', () => {
    const summary = objectionsSummary({
      state: 'value',
      probe,
      brand: 'Acme',
      answers: 0,
      answered_by: [],
      average: null,
      groups: [group('Fit', null, [])],
    });
    expect(summary.headline).toBe('No engine answered the objection question');
    expect(summary.raised).toEqual([]);
  });
});
