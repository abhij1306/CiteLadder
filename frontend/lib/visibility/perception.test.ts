import { describe, expect, it } from 'vite-plus/test';
import {
  breakdownRow,
  coverageLine,
  formatNet,
  categoryShare,
  filterCategories,
  rankCategories,
  sampleNote,
  sampleShare,
  sentimentFigureValue,
  sentimentReading,
  sentimentTrend,
  sortCategories,
  stateCopy,
} from './perception';

const RUN = '11111111-1111-4111-8111-111111111111';

function score(positive: number, neutral: number, negative: number, mixed = 0) {
  const classified = positive + neutral + negative + mixed;
  return {
    positive,
    neutral,
    negative,
    mixed,
    classified,
    positive_share: classified ? positive / classified : null,
    negative_share: classified ? negative / classified : null,
    net_sentiment: classified ? ((positive - negative) * 100) / classified : null,
  };
}

function cover(mentions: number, classified: number) {
  return {
    mentions,
    classified,
    pending: mentions - classified,
    not_assessable: 0,
    low_confidence: 0,
    unavailable: [],
  };
}

const RUN_QUOTE = {
  text: 'sizes run small',
  theme: 'Sizing',
  attribute: { kind: 'labelled' as const, name: 'Runs small' },
  entity: 'Acme',
  is_brand: true,
  logical_engine: 'chatgpt',
  prompt: 'kids pyjamas?',
  run_id: RUN,
  execution_id: RUN,
  observed_at: '2026-11-01T00:00:00Z',
  extractor_version: 'x1',
  template_version: 't1',
};

function category(name: string, negative: number, positive: number, attributes: string[] = []) {
  return {
    category: name,
    mentions: negative + positive,
    negative,
    positive,
    attributes: attributes.map((attribute, index) => ({
      attribute,
      negative: index % 2 ? 0 : 1,
      positive: index % 2 ? 1 : 0,
      quotes: [
        {
          ...RUN_QUOTE,
          text: attribute,
          polarity: index % 2 ? ('positive' as const) : ('negative' as const),
        },
      ],
    })),
  };
}

describe('perception derivations', () => {
  it('ranks categories by the chosen side, ties by name, and leaves out those with none on it', () => {
    const categories = [
      category('Pricing', 4, 1),
      category('Support', 0, 5),
      category('Delivery', 4, 2),
    ];
    expect(rankCategories(categories, 'negative').map((c) => c.category)).toEqual([
      'Delivery',
      'Pricing',
    ]);
    expect(rankCategories(categories, 'positive').map((c) => c.category)).toEqual([
      'Support',
      'Delivery',
      'Pricing',
    ]);
  });

  it('sorts categories by a column either way, an unjudged share last when descending', () => {
    const categories = [
      category('Pricing', 1, 3),
      category('Delivery', 3, 1),
      category('Support', 0, 0),
      category('Apparel', 3, 3),
    ];
    const names = (sort: Parameters<typeof sortCategories>[1]) =>
      sortCategories(categories, sort).map((c) => c.category);
    expect(names({ key: 'share', descending: true })).toEqual([
      'Delivery',
      'Apparel',
      'Pricing',
      'Support',
    ]);
    expect(names({ key: 'negative', descending: true })).toEqual([
      'Apparel',
      'Delivery',
      'Pricing',
      'Support',
    ]);
    expect(names({ key: 'attribute', descending: false })).toEqual([
      'Apparel',
      'Delivery',
      'Pricing',
      'Support',
    ]);
  });

  it('filters categories by side and search, keeping only the matching attributes and quotes', () => {
    const categories = [
      category('Sizing', 2, 1, ['Runs small', 'True to size']),
      category('Price', 0, 3, ['Cheap basics']),
    ];
    const negative = filterCategories(categories, { query: '', polarity: 'negative' });
    expect(negative.map((c) => [c.category, c.attributes.map((a) => a.attribute)])).toEqual([
      ['Sizing', ['Runs small']],
    ]);
    const searched = filterCategories(categories, { query: ' TRUE ', polarity: 'all' });
    expect(searched.map((c) => [c.category, c.attributes.map((a) => a.attribute)])).toEqual([
      ['Sizing', ['True to size']],
    ]);
    const named = filterCategories(categories, { query: 'price', polarity: 'all' });
    expect(named.map((c) => [c.category, c.attributes.map((a) => a.attribute)])).toEqual([
      ['Price', ['Cheap basics']],
    ]);
  });

  it('shows a share as counts below the sample size and as a percentage from it', () => {
    expect(
      [category('a', 1, 3), category('b', 2, 3), category('c', 0, 0)].map((c) => categoryShare(c)),
    ).toEqual([
      { kind: 'value', share: 0.25, text: '1 / 4', count: 1, basis: 4, small: true },
      { kind: 'value', share: 0.4, text: '40.0%', count: 2, basis: 5, small: false },
      { kind: 'empty' },
    ]);
  });

  it('switches breakdown shares to counts below the minimum and gates net sentiment', () => {
    const row = (s: ReturnType<typeof score>, mentions: number) => ({
      key: 'k',
      label: 'K',
      score: s,
      coverage: cover(mentions, s.classified),
    });
    const full = breakdownRow(row(score(12, 4, 3, 1), 30), 20);
    expect([full.small, full.positive, full.net]).toEqual([
      false,
      { kind: 'value', share: 0.6, text: '60.0%', count: 12, basis: 20, small: false },
      { kind: 'value', text: '+45' },
    ]);
    const small = breakdownRow(row(score(10, 5, 4), 25), 20);
    expect([small.small, small.negative, small.net]).toEqual([
      true,
      { kind: 'value', share: 4 / 19, text: '4 / 19', count: 4, basis: 19, small: true },
      { kind: 'too_few', basis: 19, minimum: 20 },
    ]);
    const none = breakdownRow(row(score(0, 0, 0), 4), 20);
    expect([none.small, none.positive, none.mentions]).toEqual([false, { kind: 'empty' }, 4]);
  });

  it('notes the counts behind a share and nothing for an empty one', () => {
    const readings = [0, 19, 20].map((basis) => sampleShare({ count: 0, basis, minimum: 20 }));
    expect(readings.map((reading) => sampleNote(reading, 'classified'))).toEqual([
      undefined,
      '0 of 19 classified',
      '0 of 20 classified',
    ]);
  });

  it('reads a net sentiment from the minimum classified count, keeping too few apart from zero', () => {
    const net = (classified: number, positive: number, negative: number) => ({
      mentions: 30,
      classified,
      positive,
      negative,
      net_sentiment: classified ? ((positive - negative) * 100) / classified : null,
    });
    expect(
      [net(20, 5, 5), net(19, 10, 1), net(0, 0, 0)].map((value) => sentimentReading(value, 20)),
    ).toEqual([
      { kind: 'value', net: '0', classified: 20, mentions: 30 },
      { kind: 'too_few', classified: 19, mentions: 30, minimum: 20 },
      { kind: 'too_few', classified: 0, mentions: 30, minimum: 20 },
    ]);
    expect([sentimentReading({ ...net(0, 0, 0), mentions: 0 }), sentimentReading(null)]).toEqual([
      { kind: 'no_mentions' },
      { kind: 'not_measured' },
    ]);
    expect(
      [{ ...net(0, 0, 0), mentions: 0 }, net(19, 10, 1), null, net(20, 15, 5)].map((value) =>
        sentimentFigureValue(value),
      ),
    ).toEqual([
      { value: null, missingLabel: 'Not named' },
      { value: null, missingLabel: 'Too few classified' },
      { value: null, missingLabel: 'Not measured' },
      { value: '+50', missingLabel: 'Not measured' },
    ]);
  });

  it('breaks the sentiment line at a point not comparable with the one before, and gaps one under the minimum', () => {
    const point = (day: string, net: number | null, comparable: boolean, positive = 20) => ({
      audit_id: RUN,
      completed_at: `2026-11-${day}T00:00:00Z`,
      score: { ...score(positive, 0, 0), net_sentiment: net },
      mentions: 1,
      extractor_version: 'x1',
      template_version: 't1',
      metrics_version: 'm1',
      comparable,
    });
    const series = sentimentTrend(
      [
        point('01', 10, false),
        point('08', null, true),
        point('15', -20, false),
        point('22', 100, true, 3),
      ],
      (iso) => iso.slice(5, 10),
    );
    expect(series.map(({ label, value, breakBefore }) => [label, value, breakBefore])).toEqual([
      ['11-01', 10, false],
      ['11-08', null, false],
      ['11-15', -20, true],
      ['11-22', null, false],
    ]);
  });
});

describe('perception display', () => {
  it('signs net sentiment and keeps a missing value missing', () => {
    expect([formatNet(33.4), formatNet(-12.6), formatNet(0), formatNet(null)]).toEqual([
      '+33',
      '-13',
      '0',
      null,
    ]);
  });

  it('names every coverage bucket that holds a mention', () => {
    expect(
      coverageLine({
        mentions: 10,
        classified: 6,
        pending: 0,
        not_assessable: 1,
        low_confidence: 2,
        unavailable: [{ reason: 'model_not_configured', count: 1 }],
      }),
    ).toBe(
      '6 of 10 mentions classified · 2 low confidence · 1 not assessable · 1 unavailable (classifier not set up)',
    );
  });

  it('names an unavailable read by its reason in a short label', () => {
    expect(stateCopy('unavailable', 'platform_cap').description).toBe('Platform limit reached');
    expect(stateCopy('unavailable', null)).toEqual({
      heading: 'Perception unavailable',
      description: null,
    });
  });
});
