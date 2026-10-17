import { describe, expect, it } from 'vite-plus/test';
import { toChartPoints } from '@/lib/visibility/trends';
import type { VisibilityTrendPoint } from '@/lib/api/types';

function point(
  rate: number | null,
  identity: string | null = 'panel-a',
  at = '2026-07-01T00:00:00Z',
): VisibilityTrendPoint {
  return {
    completed_at: at,
    brand_mention_rate: rate,
    owned_citation_rate: rate,
    sov: { mention: rate },
    comparison_key: identity,
    analyzer_versions: ['v1'],
    scoring_rule_versions: ['v1'],
    spans_version_boundary: false,
  } as VisibilityTrendPoint;
}

describe('measurement history', () => {
  it('preserves precision and elapsed time', () => {
    const points = toChartPoints(
      [point(0.201), point(0.204, 'panel-a', '2026-07-04T00:00:00Z')],
      'brand_mention_rate',
    );
    const [first, second] = points;
    expect(second!.value! - first!.value!).toBeCloseTo(0.3);
    expect(second!.timestamp! - first!.timestamp!).toBe(3 * 24 * 60 * 60 * 1000);
    expect(second!.breakBefore).toBe(false);
  });

  it('preserves unavailable observations separately from measured zero', () => {
    const points = toChartPoints([point(0), point(null), point(0.7)], 'brand_mention_rate');
    expect(points.map((item) => item.value)).toEqual([0, null, 70]);
  });

  it('breaks at changed and unknown identities', () => {
    const points = toChartPoints(
      [point(0.5), point(0.6, 'panel-b'), point(0.7, null), point(0.8, null)],
      'brand_mention_rate',
    );
    expect(points.slice(1).every((item) => item.breakBefore)).toBe(true);
  });

  it('breaks at scoring changes even when the panel is unchanged', () => {
    const changed = { ...point(0.6), scoring_rule_versions: ['v2'] };
    expect(toChartPoints([point(0.5), changed], 'sov')[1]?.breakBefore).toBe(true);
  });

  it('returns no fabricated points for empty history', () => {
    expect(toChartPoints([], 'sov')).toEqual([]);
  });
});
