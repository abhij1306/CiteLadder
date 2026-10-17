import { describe, expect, it } from 'vite-plus/test';

import type { PerformanceWindow } from '@/lib/api/performance';
import {
  DIALOG_RANGE_OPTIONS,
  DIMENSION_TABS,
  METRIC_CARDS,
  QUICK_RANGE_OPTIONS,
  RANGE_OPTIONS,
  axisDomainMax,
  canCompareYearOverYear,
  computeTickIndices,
  defaultSort,
  describeWindow,
  differenceTone,
  formatDifference,
  formatMetric,
  metricDifference,
  toChartPoints,
  toggleSort,
  windowLength,
} from '@/lib/performance/performance';

function window(overrides: Partial<PerformanceWindow> = {}): PerformanceWindow {
  return {
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    window_start: '2026-07-22',
    window_end: '2026-07-28',
    evidence_state: 'available',
    totals: {
      clicks: 12,
      impressions: 340,
      ctr: 0.0353,
      position: 8.4,
      sessions: 20,
      key_events: 2,
    },
    series: { clicks: [], impressions: [], ctr: [], position: [] },
    ...overrides,
  };
}

describe('metric formatting', () => {
  it('renders each metric in its own unit', () => {
    expect(formatMetric('clicks', 1204)).toBe('1,204');
    expect(formatMetric('ctr', 0.0353)).toBe('3.5%');
    expect(formatMetric('position', 8.42)).toBe('8.4');
  });

  it('renders a null metric as not measured, never as zero', () => {
    for (const card of METRIC_CARDS) {
      expect(formatMetric(card.key, null)).not.toBe('0');
      expect(formatMetric(card.key, null)).toMatch(/not measured/i);
    }
  });
});

describe('comparison differences', () => {
  it('is the absolute difference of two observed values', () => {
    expect(metricDifference(14, 8)).toBe(6);
    expect(formatDifference('clicks', 6)).toBe('+6');
    expect(formatDifference('clicks', -3)).toBe('−3');
    expect(formatDifference('clicks', 0)).toBe('0');
  });

  it('is unavailable when either side was not observed', () => {
    // A key the comparison period never saw has no difference. Substituting
    // zero would report a change that was never measured.
    expect(metricDifference(14, null)).toBeNull();
    expect(metricDifference(14, undefined)).toBeNull();
    expect(metricDifference(null, 8)).toBeNull();
    expect(formatDifference('clicks', null)).toMatch(/not measured/i);
  });

  it('inverts tone for position, where lower is better', () => {
    expect(differenceTone('clicks', 5)).toBe('up');
    expect(differenceTone('clicks', -5)).toBe('down');
    expect(differenceTone('position', -2)).toBe('up');
    expect(differenceTone('position', 2)).toBe('down');
    expect(differenceTone('position', 0)).toBe('flat');
    expect(differenceTone('clicks', null)).toBe('flat');
  });
});

describe('window description', () => {
  it('states the covered dates', () => {
    expect(describeWindow(window())).toContain('–');
    expect(windowLength(window())).toBe(7);
  });

  it('says so when no dates resolved', () => {
    const unresolved = window({ snapshot_id: null, window_start: '', window_end: '' });
    expect(describeWindow(unresolved)).toBe('No dates resolved');
    expect(windowLength(unresolved)).toBe(0);
  });
});

describe('year-over-year availability', () => {
  it('needs more than a year of history beyond the selected window', () => {
    // A first connect imports 365 days, so YoY is genuinely unavailable
    // until history accumulates — it must never render as an observed zero.
    expect(canCompareYearOverYear(365, 7)).toBe(false);
    expect(canCompareYearOverYear(371, 7)).toBe(true);
    expect(canCompareYearOverYear(0, 1)).toBe(false);
  });
});

describe('chart projection', () => {
  it('indexes points by position and keeps their real dates', () => {
    const points = toChartPoints([
      { date: '2026-07-22', value: 3 },
      { date: '2026-07-23', value: null },
    ]);
    // Positional, because a comparison window covers different dates.
    expect(points.map((point) => point.index)).toEqual([1, 2]);
    expect(points[0]?.date).toBe('2026-07-22');
    // A null bucket stays null: the line breaks rather than dropping to zero.
    expect(points[1]!.value).toBeNull();
  });

  it('scales the axis to a nice ceiling at or above the series max', () => {
    expect(axisDomainMax(0)).toBe(10);
    expect(axisDomainMax(340)).toBeGreaterThanOrEqual(340);
    expect(axisDomainMax(340)).toBeLessThan(680);
  });
});

describe('dimension tabs', () => {
  it('lists the six tables in Search Console order', () => {
    expect(DIMENSION_TABS.map((tab) => tab.label)).toEqual([
      'QUERIES',
      'PAGES',
      'COUNTRIES',
      'DEVICES',
      'SEARCH APPEARANCE',
      'DAYS',
    ]);
  });

  it('reads days chronologically and everything else by clicks', () => {
    expect(defaultSort('day')).toBe('dimension_key');
    expect(defaultSort('query')).toBe('-clicks');
  });

  it('sorts a new column descending first, then toggles it', () => {
    expect(toggleSort('-clicks', 'impressions')).toBe('-impressions');
    expect(toggleSort('-clicks', 'clicks')).toBe('clicks');
    expect(toggleSort('clicks', 'clicks')).toBe('-clicks');
  });
});

describe('range options', () => {
  it('includes quick ranges and extended presets', () => {
    expect(QUICK_RANGE_OPTIONS.map((o) => o.value)).toEqual(['day', 'week', 'month']);
    expect(DIALOG_RANGE_OPTIONS.map((o) => o.value)).toEqual([
      '3_months',
      '6_months',
      'last_synced',
      'custom',
    ]);
    expect(RANGE_OPTIONS.map((o) => o.value)).toEqual([
      'day',
      'week',
      'month',
      '3_months',
      '6_months',
      'last_synced',
      'custom',
    ]);
  });
});

describe('tick indices calculation', () => {
  it('returns empty for 0 columns', () => {
    expect(computeTickIndices(0)).toEqual([]);
  });

  it('returns all indices when count is smaller than max ticks', () => {
    expect(computeTickIndices(4)).toEqual([0, 1, 2, 3]);
  });

  it('samples evenly when count exceeds max ticks', () => {
    const ticks = computeTickIndices(28, 6);
    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(27);
  });

  it('returns one real tick rather than NaN when fewer than two are asked for', () => {
    expect(computeTickIndices(28, 1)).toEqual([0]);
    expect(computeTickIndices(28, 0)).toEqual([0]);
  });
});
