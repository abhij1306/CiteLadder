import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';

import type { VisibilityTrendPoint } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';

import { CompetitorTrend } from './competitor-trend';

const ranking = (name: string, mention: number, isBrand = false) => ({
  name,
  is_brand: isBrand,
  logo_url: null,
  website_url: null,
  mention_rate: mention,
  citation_rate: 0.1,
  share_of_voice: 0.2,
  mention_count: 3,
  avg_position: null,
});

function point(day: string, brandRate: number, competitorRate: number | null) {
  return {
    audit_id: null,
    completed_at: `2026-11-${day}T00:00:00Z`,
    brand_mention_rate: brandRate,
    owned_citation_rate: 0.1,
    sov: { mention: 0.2 },
    avg_position: null,
    rankings: [
      ranking('Acme', brandRate, true),
      ...(competitorRate === null ? [] : [ranking('Globex', competitorRate)]),
    ],
    analyzer_versions: ['1'],
    scoring_rule_versions: ['1'],
    spans_version_boundary: false,
    comparison_key: 'k',
    events: [],
  } as unknown as VisibilityTrendPoint;
}

describe('Competitor focus chart', () => {
  it('draws your line in the you tone and the competitor as a rival, gaps where it went unmeasured', () => {
    const query = {
      data: [point('01', 0.2, null), point('02', 0.25, 0.6), point('03', 0.3, null)],
      isError: false,
      isSuccess: true,
      isFetching: false,
    } as unknown as UseQueryResult<VisibilityTrendPoint[]>;
    const { container } = render(<CompetitorTrend name="Globex" query={query} />);
    const marks = (selector: string) => container.querySelectorAll(selector).length;
    expect(marks('[data-trend-point="you"]')).toBe(3);
    expect(marks('[data-trend-point^="rival"]')).toBe(1);
  });
});
