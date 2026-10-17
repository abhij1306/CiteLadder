import { describe, expect, it } from 'vitest';
import { policy } from '../src/config.ts';
import { detectTrends } from '../src/demand/detectors.ts';
import { aggregate, detectSearchSignals, type QueryInput } from '../src/demand/projection.ts';
import type { QueryClassification } from '../src/demand/classification.ts';
import { addDays } from '../src/referrals/projection.ts';

const p = policy.demand;
const windowEnd = '2026-09-28';
const recentDay = windowEnd;
const priorDay = addDays(windowEnd, -p.DEMAND_TREND_WINDOW_DAYS);
const beforeWindows = addDays(windowEnd, -2 * p.DEMAND_TREND_WINDOW_DAYS);

function row(
  query: string,
  observed: string,
  impressions: number,
  classification = 'non_branded',
): QueryInput {
  return {
    observed_date: observed,
    property_ref: 'sc-domain:example.com',
    normalized_query: query,
    resolved_page_url: `https://example.com/${query.replaceAll(' ', '-')}`,
    resolution_outcome: 'exact',
    classification,
    classifier_version: 'v1',
    classification_override_id: null,
    impressions,
    clicks: 0,
    position: 5,
    source_metric_row_id: `${query}-${observed}`,
    source_artifact_id: 'artifact',
    page_title: '',
    page_h1_texts: [],
    page_primary_content: '',
    page_content_usable: false,
    page_analysis_id: null,
    page_artifact_id: null,
  };
}

/** Branded rows give every required day coverage without joining a trend group. */
const coverage = Array.from({ length: p.DEMAND_TREND_REQUIRED_DAYS }, (_, day) =>
  row('brand', addDays(windowEnd, -day), 1, 'branded'),
);

describe('query trend detection', () => {
  it('classifies emerging and declining queries from the two comparison windows only', () => {
    const result = detectTrends(
      [
        ...coverage,
        row('rising widgets', priorDay, 20),
        row('rising widgets', recentDay, 60),
        // Older evidence is outside both windows, so it is not the candidate's source.
        row('rising widgets', beforeWindows, 5),
        row('falling widgets', priorDay, 60),
        row('falling widgets', recentDay, 20),
        // Impressions before the prior window must not turn a flat query into a decline.
        row('steady widgets', beforeWindows, 1000),
        row('steady widgets', priorDay, 40),
        row('steady widgets', recentDay, 40),
        // A window below the minimum is not evidence of emergence.
        row('thin widgets', priorDay, p.DEMAND_TREND_MIN_WINDOW_IMPRESSIONS - 1),
        row('thin widgets', recentDay, 80),
      ],
      windowEnd,
    );
    expect(result.state).toBe('available');
    expect(
      result.candidates.map(({ topic_cluster, signal_type, metrics }) => ({
        topic_cluster,
        signal_type,
        prior: metrics.prior_impressions,
        recent: metrics.recent_impressions,
      })),
    ).toEqual([
      {
        topic_cluster: 'falling widgets',
        signal_type: p.DEMAND_SIGNAL_DECLINING_QUERY,
        prior: 60,
        recent: 20,
      },
      {
        topic_cluster: 'rising widgets',
        signal_type: p.DEMAND_SIGNAL_EMERGING_QUERY,
        prior: 20,
        recent: 60,
      },
    ]);
    const rising = result.candidates.find((c) => c.topic_cluster === 'rising widgets')!;
    expect(rising.evidence.source_metric_row_ids).toEqual([
      `rising widgets-${priorDay}`,
      `rising widgets-${recentDay}`,
    ]);
  });

  it('anchors on the latest observed day, so trailing Search Console lag is not a gap', () => {
    const lagged = (r: QueryInput) => ({ ...r, observed_date: addDays(r.observed_date, -2) });
    const result = detectTrends(
      [
        ...coverage.map(lagged),
        lagged(row('rising widgets', priorDay, 20)),
        lagged(row('rising widgets', recentDay, 60)),
      ],
      windowEnd,
    );
    expect(result.state).toBe('available');
    expect(result.candidates.map((c) => c.metrics)).toMatchObject([
      { prior_impressions: 20, recent_impressions: 60 },
    ]);
  });

  it('abstains when any required day lacks coverage', () => {
    const result = detectTrends(
      [
        ...coverage.filter((r) => r.observed_date !== addDays(windowEnd, -3)),
        row('rising widgets', priorDay, 20),
        row('rising widgets', recentDay, 60),
      ],
      windowEnd,
    );
    expect(result).toMatchObject({ state: 'insufficient_history', candidates: [] });
  });
});

describe('search signal detection', () => {
  const search = (target_kind: string, target: string, impressions: number) => ({
    source_metric_row_ids: [`${target}-row`],
    source_artifact_ids: ['artifact'],
    target_kind,
    target,
    impressions,
    clicks: 0,
  });
  const classes: Record<string, QueryClassification> = {
    'acme pricing': 'branded',
    acme: 'ambiguous',
  };
  const queryClass = (query: string) => ({
    classification: classes[query] ?? 'non_branded',
    classifier_version: 'v1',
    override_id: null,
  });

  it('flags only non-branded low-CTR queries and keeps the highest-impression targets', () => {
    const cap = p.DEMAND_LOW_CTR_MAX_SIGNALS;
    const generic = Array.from({ length: cap }, (_, i) =>
      search('query', `widget ${i}`, p.DEMAND_MIN_IMPRESSIONS + i + 1),
    );
    const signals = detectSearchSignals(
      [
        search('query', 'acme pricing', 100_000),
        search('query', 'acme', 100_000),
        search('page', 'https://example.com/widgets', 50_000),
        ...generic,
      ],
      queryClass,
    );
    expect(signals).toHaveLength(cap);
    const targets = signals.map((s) => s.evidence.target);
    expect(targets).not.toContain('acme pricing');
    expect(targets).not.toContain('acme');
    expect(targets[0]).toBe('https://example.com/widgets');
    // The lowest-impression generic query is the one the cap drops.
    expect(targets).not.toContain('widget 0');
    expect(targets).toContain(`widget ${cap - 1}`);
  });
});

describe('query aggregation', () => {
  it('weights position by the impressions that report one', () => {
    const positioned = row('widgets', windowEnd, 30);
    const unpositioned = { ...row('widgets', windowEnd, 70), position: null };
    const a = aggregate([{ ...positioned, position: 4 }, unpositioned]);
    expect(a.impressions).toBe(100);
    expect(a.position).toBe(4);
  });
});
