import { describe, expect, it } from 'vite-plus/test';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { rangeToFrom, toChartPoints } from '@/lib/visibility/trends';
import type { VisibilityTrendPoint } from '@citeladder/contracts';

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
  it('keeps a bucket’s calendar day west of UTC and shows a run in the display zone', () => {
    const bucket = { ...point(0.5, 'panel-a', '2026-11-01T00:00:00Z'), audit_id: null };
    const run = {
      ...point(0.5, 'panel-a', '2026-11-01T02:00:00Z'),
      audit_id: '11111111-1111-4111-8111-111111111111',
    };
    const [day, instant] = toChartPoints([bucket, run], 'sov', 'America/New_York');
    expect(day).toMatchObject({ label: 'Nov 1', dateLabel: 'Nov 1, 2026' });
    expect(instant).toMatchObject({ label: 'Oct 31', dateLabel: 'Oct 31, 2026' });
  });
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

  it("plots win rate and sentiment from the brand's own row, gapping sentiment under the classified minimum", () => {
    const withBrand = (classified: number, winRate: number | null) => ({
      ...point(0.5),
      rankings: [
        { name: 'Globex', is_brand: false, win_rate: 0.9, sentiment: null },
        {
          name: 'Acme',
          is_brand: true,
          win_rate: winRate,
          sentiment: { mentions: 30, classified, positive: 15, negative: 5, net_sentiment: 50 },
        },
      ],
    });
    const points = [
      withBrand(20, 0.25),
      withBrand(19, null),
      { ...point(0.5), rankings: [] },
    ] as VisibilityTrendPoint[];
    expect([
      toChartPoints(points, 'win_rate').map((item) => item.value),
      toChartPoints(points, 'sentiment').map((item) => item.value),
    ]).toEqual([
      [25, null, null],
      [50, null, null],
    ]);
  });

  it('returns no fabricated points for empty history', () => {
    expect(toChartPoints([], 'sov')).toEqual([]);
  });
});

describe('range presets', () => {
  it('resolves a preset to the same day-aligned bound across mounts', () => {
    const scope = { workspaceId: 'w-1', projectId: 'p-1' };
    const keyAt = (now: string) =>
      visibilityQueries.trends(scope, { from: rangeToFrom('90d', new Date(now)) }).queryKey;
    expect(keyAt('2026-11-18T14:00:57.928Z')).toEqual(keyAt('2026-11-18T14:01:19.126Z'));
    expect(rangeToFrom('90d', new Date('2026-11-18T14:00:57.928Z'))).toBe(
      '2026-08-20T00:00:00.000Z',
    );
    expect(rangeToFrom('1y', new Date('2026-11-18T23:59:59.999Z'))).toBe(
      '2025-11-18T00:00:00.000Z',
    );
    expect(rangeToFrom('all', new Date('2026-11-18T14:00:57.928Z'))).toBeUndefined();
  });
});
