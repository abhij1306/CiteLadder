/**
 * Performance surface helpers.
 *
 * Pure, framework-free helpers the `/performance` screen uses to turn the
 * backend projection into chart points, card values, tab labels, and display
 * strings. The read endpoints are the single source of truth; nothing here
 * recomputes a metric — it only projects persisted values for display
 *. Null metrics stay null and render as explicit not-measured
 * labels or chart gaps, never as invented zeros.
 *
 * There are deliberately NO percentage-change helpers. A comparison on this
 * surface is a second persisted window rendered beside the first, exactly as
 * Search Console does it: two absolute values and their absolute difference,
 * so a reader is never shown a derived ratio whose denominator they cannot
 * see.
 */
import type {
  PerformanceCompare,
  PerformanceDashboardParams,
  PerformanceDimension,
  PerformanceGranularity,
  PerformanceRange,
  PerformanceSeriesPoint,
  PerformanceWindow,
} from '@/lib/api/performance';
import {
  absent,
  formatCount,
  formatCountry,
  formatMean,
  type Formatted,
  formatWindowDate,
  percentText,
} from '@/lib/format';

export const QUICK_RANGE_OPTIONS: readonly {
  value: Extract<PerformanceRange, 'day' | 'week' | 'month'>;
  label: string;
}[] = [
  { value: 'day', label: 'Last day' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 28 days' },
] as const;

export const DIALOG_RANGE_OPTIONS: readonly {
  value: Extract<PerformanceRange, '3_months' | '6_months' | 'last_synced' | 'custom'>;
  label: string;
}[] = [
  { value: '3_months', label: 'Last 90 days' },
  { value: '6_months', label: 'Last 180 days' },
  { value: 'last_synced', label: 'Last synced' },
  { value: 'custom', label: 'Custom' },
] as const;

export const RANGE_OPTIONS: readonly { value: PerformanceRange; label: string }[] = [
  ...QUICK_RANGE_OPTIONS,
  ...DIALOG_RANGE_OPTIONS,
] as const;

export const GRANULARITY_OPTIONS: readonly {
  value: PerformanceGranularity;
  label: string;
}[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
] as const;

export const COMPARE_OPTIONS: readonly {
  value: PerformanceCompare;
  label: string;
}[] = [
  { value: 'none', label: 'No comparison' },
  { value: 'previous', label: 'Previous period' },
  { value: 'year_over_year', label: 'Year over year' },
  { value: 'custom', label: 'Custom' },
] as const;

export type RangeSelection = {
  range: PerformanceRange;
  from: string;
  to: string;
  compare: PerformanceCompare;
  compareFrom: string;
  compareTo: string;
};

export const INITIAL_SELECTION: RangeSelection = {
  range: 'last_synced',
  from: '',
  to: '',
  compare: 'none',
  compareFrom: '',
  compareTo: '',
};

export const INITIAL_GRANULARITY: PerformanceGranularity = 'day';

export function dashboardParams(
  selection: RangeSelection,
  granularity: PerformanceGranularity,
): PerformanceDashboardParams {
  return {
    range: selection.range,
    granularity,
    from: selection.range === 'custom' && selection.from ? selection.from : undefined,
    to: selection.range === 'custom' && selection.to ? selection.to : undefined,
    compare: selection.compare,
    compare_from:
      selection.compare === 'custom' && selection.compareFrom ? selection.compareFrom : undefined,
    compare_to:
      selection.compare === 'custom' && selection.compareTo ? selection.compareTo : undefined,
  };
}

export const INITIAL_DASHBOARD_PARAMS = dashboardParams(INITIAL_SELECTION, INITIAL_GRANULARITY);

const YEAR_OVER_YEAR_SHIFT_DAYS = 364;

export function canCompareYearOverYear(coveredDays: number, selectedDays: number): boolean {
  return coveredDays >= YEAR_OVER_YEAR_SHIFT_DAYS + selectedDays;
}

export function windowLength(window: PerformanceWindow): number {
  if (!window.window_start || !window.window_end) return 0;
  const start = Date.parse(`${window.window_start}T00:00:00Z`);
  const end = Date.parse(`${window.window_end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function describeWindow(window: PerformanceWindow): string {
  if (!window.window_start || !window.window_end) return '';
  return `${formatWindowDate(window.window_start)} – ${formatWindowDate(window.window_end)}`;
}

export type PerformanceMetricKey = 'clicks' | 'impressions' | 'ctr' | 'position';

export const METRIC_CARDS: readonly {
  key: PerformanceMetricKey;
  label: string;
}[] = [
  { key: 'clicks', label: 'Clicks' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'ctr', label: 'CTR' },
  { key: 'position', label: 'Average position' },
] as const;

function isInvertedMetric(key: PerformanceMetricKey): boolean {
  return key === 'position';
}

export function formatMetric(key: PerformanceMetricKey, value: number): string;
export function formatMetric(key: PerformanceMetricKey, value: number | null): Formatted;
export function formatMetric(key: PerformanceMetricKey, value: number | null): Formatted {
  if (value === null) return absent();
  if (key === 'ctr') return percentText(value);
  if (key === 'position') return formatMean(value);
  return formatCount(value);
}

export function metricDifference(
  selected: number | null,
  comparison: number | null | undefined,
): number | null {
  if (selected === null || comparison === null || comparison === undefined) return null;
  return selected - comparison;
}

export type MetricDelta = {
  value: number | null;
  precision: number;
  unit: string;
  policy: 'higher-is-better' | 'lower-is-better';
};

export function metricDelta(key: PerformanceMetricKey, difference: number | null): MetricDelta {
  const policy = isInvertedMetric(key) ? 'lower-is-better' : 'higher-is-better';
  if (key === 'ctr') {
    return {
      value: difference === null ? null : difference * 100,
      precision: 1,
      unit: ' pp',
      policy,
    };
  }
  return { value: difference, precision: key === 'position' ? 1 : 0, unit: '', policy };
}

export type PerformanceChartPoint = {
  index: number;
  date: string | null;
  value: number | null;
};

export function toChartPoints(series: readonly PerformanceSeriesPoint[]): PerformanceChartPoint[] {
  return series.map((point, index) => ({
    index: index + 1,
    date: point.date || null,
    value: point.value,
  }));
}

export function formatAxisTick(key: PerformanceMetricKey, value: number): string {
  if (key === 'ctr') return percentText(value);
  if (key === 'position') return formatMean(value);
  if (value <= 0) return '0';
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : Math.round(thousands * 10) / 10}K`;
  }
  return `${Math.round(value)}`;
}

export type SearchConsoleDimension = Exclude<PerformanceDimension, 'bing_query' | 'bing_page'>;

type DimensionTab<Value extends PerformanceDimension> = {
  value: Value;
  label: string;
  header: string;
  noun: string;
};
type DimensionTabs<Value extends PerformanceDimension> = readonly [
  DimensionTab<Value>,
  ...DimensionTab<Value>[],
];

export const DIMENSION_TABS: DimensionTabs<SearchConsoleDimension> = [
  { value: 'query', label: 'Queries', header: 'Top queries', noun: 'queries' },
  { value: 'page', label: 'Pages', header: 'Top pages', noun: 'pages' },
  { value: 'country', label: 'Countries', header: 'Top countries', noun: 'countries' },
  { value: 'device', label: 'Devices', header: 'Top devices', noun: 'devices' },
  {
    value: 'search_appearance',
    label: 'Search appearance',
    header: 'Search appearance',
    noun: 'appearance types',
  },
  { value: 'day', label: 'Days', header: 'Date', noun: 'days' },
] as const;

export const BING_DIMENSION_TABS: DimensionTabs<
  Extract<PerformanceDimension, 'bing_query' | 'bing_page'>
> = [
  { value: 'bing_query', label: 'Queries', header: 'Top queries', noun: 'queries' },
  { value: 'bing_page', label: 'Pages', header: 'Top pages', noun: 'pages' },
] as const;

export function dimensionTab(dimension: PerformanceDimension) {
  return (
    [...DIMENSION_TABS, ...BING_DIMENSION_TABS].find((tab) => tab.value === dimension) ??
    DIMENSION_TABS[0]
  );
}

export const DIMENSION_SORT_KEY = 'dimension_key';

export function defaultSort(dimension: PerformanceDimension): string {
  return dimension === 'day' ? DIMENSION_SORT_KEY : '-clicks';
}

export function sortKey(sort: string): string {
  return sort.startsWith('-') ? sort.slice(1) : sort;
}

export function sortDirection(sort: string): 'ascending' | 'descending' {
  return sort.startsWith('-') ? 'descending' : 'ascending';
}

export function toggleSort(current: string, key: string): string {
  if (current === `-${key}`) return key;
  return `-${key}`;
}

export function formatDimensionValue(
  dimension: PerformanceDimension,
  displayValue: string,
): string {
  if (dimension === 'day') return formatWindowDate(displayValue);
  if (dimension === 'country') return formatCountry(displayValue);
  return displayValue;
}
