import { describe, expect, it } from 'vite-plus/test';

import type { RankingRow } from '@citeladder/contracts';

import { brandStanding, standingHeadline, winRateAbsence } from './ranking';

function row(name: string, mention: number | null, isBrand = false): RankingRow {
  return {
    name,
    is_brand: isBrand,
    logo_url: null,
    website_url: null,
    mention_rate: mention,
    citation_rate: null,
    share_of_voice: null,
    mention_count: 0,
    avg_position: null,
  };
}

const headline = (rows: RankingRow[]) => standingHeadline(brandStanding(rows));

describe('Insights headline', () => {
  it.each([
    [
      'names the nearest brand ahead',
      [row('Leader', 0.9), row('Near', 0.6), row('You', 0.4, true), row('Back', 0.1)],
      { headline: "You're #3 in AI visibility", sub: 'Near is named more often.' },
    ],
    [
      'names the nearest brand behind at the top',
      [row('You', 0.7, true), row('Second', 0.5), row('Third', 0.2)],
      { headline: "You're #1 in AI visibility", sub: "You're named more often than Second." },
    ],
    [
      'closes on a brand that ends in a full stop with one stop',
      [row('You', 0.7, true), row('Bluebird Bean Co.', 0.5)],
      {
        headline: "You're #1 in AI visibility",
        sub: "You're named more often than Bluebird Bean Co.",
      },
    ],
    [
      'shares a rank on a tie and says who ties',
      [row('Leader', 0.9), row('Zulu', 0.5), row('Acme', 0.5, true), row('Back', 0.1)],
      {
        headline: "You're #2 in AI visibility",
        sub: 'Leader is named more often. Zulu is named as often as you.',
      },
    ],
    [
      'ranks a measured zero rather than calling it unmeasured',
      [row('Leader', 0.4), row('You', 0, true)],
      { headline: "You're #2 in AI visibility", sub: 'Leader is named more often.' },
    ],
    [
      'ignores an unmeasured competitor beside measured ones',
      [row('You', 0.3, true), row('Ghost', null), row('Rival', 0.1)],
      { headline: "You're #1 in AI visibility", sub: "You're named more often than Rival." },
    ],
    [
      'says no competitors are tracked',
      [row('You', 0.3, true)],
      { headline: "You aren't tracking any competitors yet", sub: null },
    ],
    [
      'keeps tracked but unmeasured competitors apart from none tracked',
      [row('You', 0.3, true), row('Ghost', null)],
      {
        headline: 'No visibility readings for your competitors in this selection',
        sub: null,
      },
    ],
    [
      'keeps an unmeasured brand apart from a zero',
      [row('Leader', 0.4), row('You', null, true)],
      { headline: 'No AI visibility readings for you in this selection', sub: null },
    ],
  ])('%s', (_, rows, expected) => {
    expect(headline(rows)).toEqual(expected);
  });
});

describe('win rate absence', () => {
  it.each([
    ['no answer named a tracked brand', 0, 'not_applicable'],
    ['the run stored no first-named data', null, 'not_measured'],
    ['the read did not serve win rate', undefined, 'not_measured'],
  ] as const)('%s', (_, winAnswers, expected) => {
    expect(winRateAbsence({ win_answers: winAnswers })).toBe(expected);
  });
});
