import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';
import { describe, expect, it } from 'vitest';

import { themeAssociation } from './theme-association';

type Entity = PerceptionResponse['entities'][number];

const SCORE = {
  positive: 0,
  neutral: 0,
  negative: 0,
  mixed: 0,
  classified: 0,
  positive_share: null,
  negative_share: null,
  net_sentiment: null,
};

function entity(
  name: string,
  classified: number,
  themes: Record<string, number>,
  isBrand = false,
): Entity {
  return {
    name,
    is_brand: isBrand,
    logo_url: null,
    website_url: null,
    score: { ...SCORE, classified },
    coverage: {
      mentions: classified,
      classified,
      pending: 0,
      not_assessable: 0,
      low_confidence: 0,
      unavailable: [],
    },
    theme_mentions: Object.entries(themes).map(([theme, mentions]) => ({ theme, mentions })),
  };
}

describe('themeAssociation', () => {
  it('shares each brand’s classified mentions by theme, too few below the minimum', () => {
    const map = themeAssociation(
      [
        entity('Acme', 20, { pricing: 4, support: 10 }, true),
        entity('Rival', 25, { pricing: 15, support: 5 }),
        entity('Tiny', 3, { pricing: 3 }),
      ],
      { minimum: 20, columns: 6 },
    );
    expect(map).toEqual({
      themes: ['pricing', 'support'],
      rows: [
        {
          name: 'Acme',
          isBrand: true,
          cells: [
            { kind: 'share', share: 0.2, mentions: 4 },
            { kind: 'share', share: 0.5, mentions: 10 },
          ],
        },
        {
          name: 'Rival',
          isBrand: false,
          cells: [
            { kind: 'share', share: 0.6, mentions: 15 },
            { kind: 'share', share: 0.2, mentions: 5 },
          ],
        },
        {
          name: 'Tiny',
          isBrand: false,
          cells: [
            { kind: 'too_few', classified: 3 },
            { kind: 'too_few', classified: 3 },
          ],
        },
      ],
      top: { theme: 'support', share: 0.5 },
      gap: { theme: 'pricing', leader: 'Rival', points: 40 },
    });
  });

  it('has no top theme or gap when your own row is too few', () => {
    const map = themeAssociation(
      [entity('Acme', 5, { pricing: 5 }, true), entity('Rival', 30, { pricing: 30 })],
      { minimum: 20 },
    );
    expect([map.top, map.gap, map.rows[1]!.cells]).toEqual([
      null,
      null,
      [{ kind: 'share', share: 1, mentions: 30 }],
    ]);
  });
});
