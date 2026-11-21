import { describe, expect, it } from 'vite-plus/test';
import {
  breakdownRow,
  coverageLine,
  formatNet,
  negativeHeadline,
  rankThemes,
  sentimentFigureValue,
  sentimentReading,
  sentimentTrend,
  stateCopy,
  themeNegativeShare,
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

const theme = (name: string, positive: number, negative: number) => ({
  theme: name,
  positive,
  negative,
  quotes: [],
});

describe('perception derivations', () => {
  it('heads the tab with the negative share from the classified minimum only', () => {
    expect(negativeHeadline(score(12, 4, 4))).toBe(
      'AI says something negative about you in 20% of classified mentions',
    );
    expect(negativeHeadline(score(15, 5, 0))).toBe(
      'AI says nothing negative about you in classified mentions',
    );
    expect(negativeHeadline(score(3, 1, 0))).toBeNull();
    expect(negativeHeadline(score(0, 0, 0))).toBeNull();
  });

  it('ranks themes by the chosen side and leaves out those with none on it', () => {
    const themes = [theme('pricing', 1, 4), theme('support', 5, 0), theme('reliability', 2, 4)];
    expect(rankThemes(themes, 'negative', 8).map((t) => t.theme)).toEqual([
      'pricing',
      'reliability',
    ]);
    expect(rankThemes(themes, 'positive', 2).map((t) => t.theme)).toEqual([
      'support',
      'reliability',
    ]);
  });

  it('shows a breakdown share only from the minimum classified count', () => {
    const row = (s: ReturnType<typeof score>, mentions: number) => ({
      key: 'k',
      label: 'K',
      score: s,
      coverage: cover(mentions, s.classified),
    });
    expect(breakdownRow(row(score(12, 4, 3, 1), 30), 20)).toEqual({
      kind: 'value',
      classified: 20,
      mentions: 30,
      positive: 0.6,
      neutral: 0.2,
      negative: 0.15,
      net: 45,
    });
    expect(breakdownRow(row(score(10, 5, 4), 25), 20)).toEqual({
      kind: 'too_few',
      classified: 19,
      mentions: 25,
      needed: 20,
    });
    expect(breakdownRow(row(score(0, 0, 0), 4), 0).kind).toBe('too_few');
    expect(themeNegativeShare(theme('price', 15, 5), 20)).toBe(0.25);
    expect(themeNegativeShare(theme('price', 1, 0), 20)).toBeNull();
    expect(themeNegativeShare(theme('price', 0, 0), 0)).toBeNull();
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

  it('explains an unavailable read by its reason', () => {
    expect(stateCopy('unavailable', 'platform_cap').description).toBe(
      'The platform classification limit was reached for these answers.',
    );
  });
});
