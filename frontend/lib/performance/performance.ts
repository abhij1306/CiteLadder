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
import { availabilityLabel, formatCount, formatWindowDate } from '@/lib/format';

/** The not-measured placeholder (null metrics — never a fabricated zero). */
const NOT_MEASURED = availabilityLabel('not_measured');

// ---------------------------------------------------------------------------
// Range and compare vocabularies
// ---------------------------------------------------------------------------

export const RANGE_OPTIONS: readonly { value: PerformanceRange; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3_months', label: '3 months' },
  { value: '6_months', label: '6 months' },
  { value: 'last_synced', label: 'Last synced' },
  { value: 'custom', label: 'Custom' },
] as const;

export const QUICK_RANGE_OPTIONS: readonly {
  value: Extract<PerformanceRange, 'day' | 'week' | 'month'>;
  label: string;
}[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

export const DIALOG_RANGE_OPTIONS: readonly {
  value: Extract<PerformanceRange, '3_months' | '6_months' | 'last_synced' | 'custom'>;
  label: string;
}[] = [
  { value: '3_months', label: '3 months' },
  { value: '6_months', label: '6 months' },
  { value: 'last_synced', label: 'Last synced' },
  { value: 'custom', label: 'Custom' },
] as const;

/**
 * The chart's bucket sizes, labelled as Search Console labels them.
 *
 * These are BUCKETS, not window lengths: "Last 28 days" charted Weekly is
 * one range at one granularity. RANGE_OPTIONS above carries the lengths.
 */
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

// ---------------------------------------------------------------------------
// The selection, its landing state, and the request it resolves to
// ---------------------------------------------------------------------------

/** Which window is drawn, and what it is measured against. */
export type RangeSelection = {
  range: PerformanceRange;
  from: string;
  to: string;
  compare: PerformanceCompare;
  compareFrom: string;
  compareTo: string;
};

/**
 * The landing selection: no preset, no comparison — the server then serves
 * the newest, widest snapshot it holds. Lives with `RangeSelection` because
 * it is that type's empty value.
 */
export const INITIAL_SELECTION: RangeSelection = {
  range: 'last_synced',
  from: '',
  to: '',
  compare: 'none',
  compareFrom: '',
  compareTo: '',
};

/** The bucket size the chart lands on. */
export const INITIAL_GRANULARITY: PerformanceGranularity = 'day';

/**
 * The dashboard request one selection resolves to. Endpoints of a window are
 * sent only when the reader actually chose them, so a preset never carries a
 * stale custom pair.
 */
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

/**
 * The request the surface lands on.
 *
 * Navigation intent warms exactly this, so a hovered link and the screen it
 * opens share ONE cache entry. Deriving it from the same defaults through the
 * same function is what keeps them identical — a hand-written second params
 * literal drifted from the screen's selection and warmed a key nothing read.
 */
export const INITIAL_DASHBOARD_PARAMS = dashboardParams(INITIAL_SELECTION, INITIAL_GRANULARITY);

/** Year over year shifts back 52 whole weeks — mirrors the backend constant. */
const YEAR_OVER_YEAR_SHIFT_DAYS = 364;

/**
 * Whether the project has enough imported history for a year-over-year
 * comparison of a window of this length.
 *
 * A first connect imports one year, so year over year is genuinely
 * unavailable until history accumulates past that. The control renders
 * disabled and says so — it must never render as an observed zero.
 */
export function canCompareYearOverYear(coveredDays: number, selectedDays: number): boolean {
  return coveredDays >= YEAR_OVER_YEAR_SHIFT_DAYS + selectedDays;
}

/** Inclusive length in days of a resolved window, or 0 when unresolved. */
export function windowLength(window: PerformanceWindow): number {
  if (!window.window_start || !window.window_end) return 0;
  const start = Date.parse(`${window.window_start}T00:00:00Z`);
  const end = Date.parse(`${window.window_end}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** "1 Jan – 28 Jan 2026", or an explicit note when the range is unresolved. */
export function describeWindow(window: PerformanceWindow): string {
  if (!window.window_start || !window.window_end) return 'No dates resolved';
  return `${formatWindowDate(window.window_start)} – ${formatWindowDate(window.window_end)}`;
}

// ---------------------------------------------------------------------------
// Metric vocabulary
// ---------------------------------------------------------------------------

export type PerformanceMetricKey = 'clicks' | 'impressions' | 'ctr' | 'position';

export const METRIC_CARDS: readonly {
  key: PerformanceMetricKey;
  label: string;
}[] = [
  { key: 'clicks', label: 'Total clicks' },
  { key: 'impressions', label: 'Total impressions' },
  { key: 'ctr', label: 'Average CTR' },
  { key: 'position', label: 'Average position' },
] as const;

/**
 * Whether a smaller value is the better one.
 *
 * Average position is a rank, so it improves downward — which flips both the
 * chart's vertical direction and the tone of a difference. One owner, because
 * the two disagreeing would draw a line one way and colour it the other.
 */
export function isInvertedMetric(key: PerformanceMetricKey): boolean {
  return key === 'position';
}

/** Persisted CTR fraction → display percent (`0.0317` → `3.2%`). */
function formatCtr(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Mean ranking position (`8.4`). */
function formatPosition(value: number): string {
  return value.toFixed(1);
}

/** One metric's display string, or the not-measured placeholder for null. */
export function formatMetric(key: PerformanceMetricKey, value: number | null): string {
  if (value === null) return NOT_MEASURED;
  if (key === 'ctr') return formatCtr(value);
  if (key === 'position') return formatPosition(value);
  return formatCount(value);
}

/**
 * The absolute difference between a selected and a comparison value.
 *
 * Null whenever EITHER side is unmeasured — a key the comparison period never
 * observed has no difference, and substituting zero would report a change
 * that was never measured.
 */
export function metricDifference(
  selected: number | null,
  comparison: number | null | undefined,
): number | null {
  if (selected === null || comparison === null || comparison === undefined) return null;
  return selected - comparison;
}

/**
 * A formatted metric, or `null` where nothing was measured.
 *
 * Same split as the visibility formatters: the words belong on the metric
 * cards above this table, the mark belongs in its cells. See `measured` in
 * `lib/visibility/dashboard.ts`.
 */
export { measured } from '@/lib/format';

/** A difference rendered with an explicit sign (`+2`, `−3`, `0`). */
export function formatDifference(key: PerformanceMetricKey, difference: number | null): string {
  if (difference === null) return NOT_MEASURED;
  if (difference === 0) return '0';
  const sign = difference > 0 ? '+' : '−';
  const magnitude = Math.abs(difference);
  if (key === 'ctr') return `${sign}${formatCtr(magnitude, 2)}`;
  if (key === 'position') return `${sign}${formatPosition(magnitude)}`;
  return `${sign}${formatCount(magnitude)}`;
}

/**
 * Whether a difference is favourable, for tone only.
 *
 * Position inverts: a smaller average position is a better ranking, so a
 * negative difference there is an improvement.
 */
export function differenceTone(
  key: PerformanceMetricKey,
  difference: number | null,
): 'up' | 'down' | 'flat' {
  if (difference === null || difference === 0) return 'flat';
  const improved = isInvertedMetric(key) ? difference < 0 : difference > 0;
  return improved ? 'up' : 'down';
}

// ---------------------------------------------------------------------------
// Chart projection
// ---------------------------------------------------------------------------

export type PerformanceChartPoint = {
  /** One-based position in the window — the chart's x identity. */
  index: number;
  /** The bucket's own date, shown on hover. */
  date: string | null;
  value: number | null;
};

/**
 * Project a persisted series onto positional chart points.
 *
 * Positional rather than date-keyed because a comparison window covers
 * DIFFERENT dates than the selection: aligning "day 1 against day 1" is the
 * only way two windows can share one x-axis, and it is what Search Console
 * does. Each point keeps its own real date for the tooltip, so the reader is
 * never left guessing which day a dashed point belongs to.
 */
export function toChartPoints(series: readonly PerformanceSeriesPoint[]): PerformanceChartPoint[] {
  return series.map((point, index) => ({
    index: index + 1,
    date: point.date || null,
    value: point.value,
  }));
}

/** The largest bucket value across every series drawn on one axis. */
export function seriesMax(...series: readonly PerformanceChartPoint[][]): number {
  return series
    .flat()
    .reduce((max, point) => (point.value !== null && point.value > max ? point.value : max), 0);
}

/** Nice-ceiling steps for truthful count domains (1/1.5/2/2.5/3/4/5/6/8 × 10^n). */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/**
 * Top of a chart axis: the smallest nice-step ceiling at or above the series
 * max, so the axis scales truthfully instead of clipping a peak.
 */
export function axisDomainMax(max: number): number {
  if (max <= 0) return 10;
  const exponent = Math.floor(Math.log10(max));
  for (const candidateExponent of [exponent - 1, exponent, exponent + 1]) {
    const base = 10 ** candidateExponent;
    for (const step of NICE_STEPS) {
      const candidate = step * base;
      if (candidate >= max) return candidate;
    }
  }
  return 10 ** (exponent + 1);
}

/** Compact axis tick: 60000 → `60K`, 1500 → `1.5K`, 500 → `500`. */
export function formatAxisTick(key: PerformanceMetricKey, value: number): string {
  if (key === 'ctr') return formatCtr(value, 1);
  if (key === 'position') return formatPosition(value);
  if (value <= 0) return '0';
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : Math.round(thousands * 10) / 10}K`;
  }
  return `${Math.round(value)}`;
}

/**
 * Compute evenly distributed tick indices for the horizontal axis.
 *
 * If `columnCount` is small (<= maxTicks), returns all indices 0..columnCount-1.
 * Otherwise, samples `maxTicks` indices evenly between 0 and columnCount-1.
 *
 * A single tick is the explicit one-tick case, not a degenerate span: the
 * even-spacing step divides by `maxTicks - 1`, so asking for fewer than two
 * ticks would divide by zero and put NaN in the returned indices.
 */
export function computeTickIndices(columnCount: number, maxTicks = 6): number[] {
  if (columnCount <= 0) return [];
  if (maxTicks <= 1) return [0];
  if (columnCount <= maxTicks) {
    return Array.from({ length: columnCount }, (_, i) => i);
  }
  const indices: number[] = [];
  const step = (columnCount - 1) / (maxTicks - 1);
  for (let i = 0; i < maxTicks; i++) {
    const idx = Math.min(columnCount - 1, Math.round(i * step));
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Dimension tabs
// ---------------------------------------------------------------------------

/**
 * A dimension the Search Console tab row can show.
 *
 * Bing's two are deliberately excluded: they have no tab and no panel in that
 * row, so a value the tabs cannot represent must not be expressible as one.
 */
export type SearchConsoleDimension = Exclude<PerformanceDimension, 'bing_query' | 'bing_page'>;

type DimensionTab<Value extends PerformanceDimension> = {
  value: Value;
  /** Uppercase tab label, in Search Console's order. */
  label: string;
  /** The first column's header, e.g. "Top queries". */
  header: string;
  /** Row noun for the pagination footer. */
  noun: string;
};
type DimensionTabs<Value extends PerformanceDimension> = readonly [
  DimensionTab<Value>,
  ...DimensionTab<Value>[],
];

export const DIMENSION_TABS: DimensionTabs<SearchConsoleDimension> = [
  { value: 'query', label: 'QUERIES', header: 'Top queries', noun: 'queries' },
  { value: 'page', label: 'PAGES', header: 'Top pages', noun: 'pages' },
  { value: 'country', label: 'COUNTRIES', header: 'Top countries', noun: 'countries' },
  { value: 'device', label: 'DEVICES', header: 'Top devices', noun: 'devices' },
  {
    value: 'search_appearance',
    label: 'SEARCH APPEARANCE',
    header: 'Search appearance',
    noun: 'appearance types',
  },
  { value: 'day', label: 'DAYS', header: 'Date', noun: 'days' },
] as const;

/**
 * Bing's own two breakdowns.
 *
 * Kept out of DIMENSION_TABS on purpose: Bing is a second engine measuring a
 * different population, so its rows belong in their own panel rather than as
 * two more tabs a reader could mistake for Search Console breakdowns. The
 * headline cards and the chart above never include them.
 */
export const BING_DIMENSION_TABS: DimensionTabs<
  Extract<PerformanceDimension, 'bing_query' | 'bing_page'>
> = [
  { value: 'bing_query', label: 'QUERIES', header: 'Top queries', noun: 'queries' },
  { value: 'bing_page', label: 'PAGES', header: 'Top pages', noun: 'pages' },
] as const;

export function dimensionTab(dimension: PerformanceDimension) {
  return (
    [...DIMENSION_TABS, ...BING_DIMENSION_TABS].find((tab) => tab.value === dimension) ??
    DIMENSION_TABS[0]
  );
}

/**
 * The first column's sort key — the row's own identity.
 *
 * Named because it is the one sort that does NOT belong to a metric column:
 * the row-identity column is always on screen, so ordering by it can never be
 * orphaned the way a hidden metric's ordering can.
 */
export const DIMENSION_SORT_KEY = 'dimension_key';

/** DAYS reads chronologically; every other table defaults to clicks descending. */
export function defaultSort(dimension: PerformanceDimension): string {
  return dimension === 'day' ? DIMENSION_SORT_KEY : '-clicks';
}

/** The sort idiom: a leading `-` is descending (the "top rows" view). */
export function sortKey(sort: string): string {
  return sort.startsWith('-') ? sort.slice(1) : sort;
}

export function sortDirection(sort: string): 'ascending' | 'descending' {
  return sort.startsWith('-') ? 'descending' : 'ascending';
}

/**
 * Column-header click: a new column sorts descending first (the "top rows"
 * view); clicking the active column toggles its direction.
 */
export function toggleSort(current: string, key: string): string {
  if (current === `-${key}`) return key;
  return `-${key}`;
}

/** Display a dimension row's value; DAYS renders its ISO key as a date. */
export function formatDimensionValue(
  dimension: PerformanceDimension,
  displayValue: string,
): string {
  return dimension === 'day' ? formatWindowDate(displayValue) : displayValue;
}
