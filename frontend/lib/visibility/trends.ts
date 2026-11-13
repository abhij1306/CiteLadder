/**
 * Cross-run Visibility trend helpers (Trend mode).
 *
 * Pure, framework-free helpers the Trend view uses to turn the backend
 * `VisibilityTrendPoint[]` projection into the chart series, headline stats,
 * version-boundary markers, and start/latest ranking tables. The trend endpoint
 * is the single source of truth; nothing here recomputes a metric — it only
 * projects persisted values for display. Average position stays
 * the not-measured placeholder when no ranked answer exists.
 */
import type { TrendPoint, TrendSeries } from '@/components/ui/trend-chart';
import type { VisibilityTrendPoint } from '@citeladder/contracts';
import {
  formatDisplayDate,
  formatDisplayShortDate,
  formatShortDate,
  formatWindowDate,
} from '@/lib/format';

/** Trend granularity — mirrors the backend `granularity=run|week|month`. */
export type TrendGranularity = 'run' | 'day' | 'week' | 'month';

export const GRANULARITY_OPTIONS: readonly { value: TrendGranularity; label: string }[] = [
  { value: 'run', label: 'Per run' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
] as const;

/** Date-range presets. `all` sends no bounds; the rest send a UTC `from`. */
export type TrendRange = 'all' | '30d' | '90d' | '1y';

export const RANGE_OPTIONS: readonly { value: TrendRange; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
] as const;

/**
 * Resolve a range preset into an inclusive UTC `from` bound (ISO 8601), or
 * `undefined` for "all time". `now` is injectable for deterministic tests.
 */
export function rangeToFrom(range: TrendRange, now: Date = new Date()): string | undefined {
  if (range === 'all') return undefined;
  const from = new Date(now);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 30);
  else if (range === '90d') from.setUTCDate(from.getUTCDate() - 90);
  else if (range === '1y') from.setUTCFullYear(from.getUTCFullYear() - 1);
  return from.toISOString();
}

/** Which headline metric a chart plots. */
export type TrendMetric = 'sov' | 'brand_mention_rate' | 'owned_citation_rate';

/**
 * A point's short axis label and full date. A run point is an instant, shown in
 * the display timezone. A day, week or month bucket (`audit_id` null) starts at
 * a UTC midnight that names a calendar day, so it keeps that day in every zone.
 */
function pointDates(point: VisibilityTrendPoint, timeZone: string) {
  if (point.audit_id === null) {
    const day = point.completed_at.slice(0, 10);
    return { label: formatShortDate(day), dateLabel: formatWindowDate(day) };
  }
  return {
    label: formatDisplayShortDate(point.completed_at, timeZone),
    dateLabel: formatDisplayDate(point.completed_at, timeZone),
  };
}

/** A metric's 0–100 value for a point (percentages scaled to whole percent). */
function metricValue(point: VisibilityTrendPoint, metric: TrendMetric): number | null {
  switch (metric) {
    case 'sov':
      return point.sov.mention === null ? null : point.sov.mention * 100;
    case 'brand_mention_rate':
      return point.brand_mention_rate === null ? null : point.brand_mention_rate * 100;
    case 'owned_citation_rate':
      return point.owned_citation_rate === null ? null : point.owned_citation_rate * 100;
  }
}

/**
 * Map the trend series into `TrendChart` points for `metric`. A point that
 * introduces a new analyzer/scoring version (its distinct version set differs
 * from the previous point's, or it spans a boundary) carries a `versionChange`
 * marker so the chart can flag it (version continuity).
 */
export function toChartPoints(
  points: readonly VisibilityTrendPoint[],
  metric: TrendMetric,
  timeZone = 'UTC',
  valueOf: (point: VisibilityTrendPoint) => number | null = (point) => metricValue(point, metric),
): (TrendPoint & { dateLabel: string })[] {
  let prevVersions: string | null = null;
  let previousIdentity: string | null | undefined = undefined;
  return points.map((point) => {
    const value = valueOf(point);
    const versionKey = [...point.analyzer_versions, ...point.scoring_rule_versions].join('|');
    const changed = prevVersions !== null && versionKey !== prevVersions;
    const identityChanged =
      previousIdentity !== undefined &&
      (!point.comparison_key || previousIdentity !== point.comparison_key);
    previousIdentity = point.comparison_key;
    prevVersions = versionKey;
    return {
      ...pointDates(point, timeZone),
      // Preserve unavailable metrics as null — the chart renders a GAP and an
      // "unavailable" label rather than coercing to a misleading zero.
      value,
      timestamp: new Date(point.completed_at).getTime(),
      breakBefore: changed || identityChanged || !point.comparison_key,
      versionChange:
        changed || point.spans_version_boundary ? { note: versionChangeNote(point) } : null,
    };
  });
}

/** Human note for a version-change marker (which version set now applies). */
function versionChangeNote(point: VisibilityTrendPoint): string {
  const scoring = point.scoring_rule_versions.join(', ') || 'unknown';
  return point.spans_version_boundary
    ? `Mixed scoring versions in this bucket (${scoring})`
    : `Scoring rule ${scoring} applied`;
}

/**
 * Categorical stroke classes for comparison lines, in a fixed order.
 *
 * Fixed so a given competitor keeps its colour while the reader changes metric
 * or period, and drawn from the design system's own chart ramp rather than a
 * palette invented here.
 */
/**
 * Comparison lines drawn by default.
 *
 * Three, plus the tracked brand: a TrendChart draws at most four lines, the
 * most that stay tellable apart by colour and dash. The roster is not
 * truncated as a result: the table beside the chart lists every brand, and
 * selecting one there plots it alone.
 */
const TREND_SERIES_LIMIT = 3;

/** Each metric reads its OWN column; the table is what keeps them paired. */
const RANKING_METRIC_COLUMN: Record<TrendMetric, (row: RankingMetricRow) => number | null> = {
  owned_citation_rate: (row) => row.citation_rate,
  sov: (row) => row.share_of_voice,
  brand_mention_rate: (row) => row.mention_rate,
};

type RankingMetricRow = {
  mention_rate: number | null;
  citation_rate: number | null;
  share_of_voice: number | null;
};

/**
 * One ranking row's value for a metric, as whole percent.
 *
 * Each metric reads its OWN column — plotting mention rate under a Share of
 * voice heading drew a line that was not the metric selected.
 */
function rankingMetricValue(row: RankingMetricRow, metric: TrendMetric): number | null {
  const value = RANKING_METRIC_COLUMN[metric](row);
  return value === null || value === undefined ? null : value * 100;
}

/**
 * The chart points for ONE named competitor, on the brand series' own x scale.
 *
 * Selecting a brand in the rankings table plots that brand ALONE, so it needs
 * the primary-series shape (marks, hover labels, version markers) rather than a
 * comparison line. Timestamps, gaps and version boundaries come from the same
 * projection as the brand's own line, so the two are read on one scale; only
 * the plotted value changes.
 */
export function toNamedChartPoints(
  points: readonly VisibilityTrendPoint[],
  metric: TrendMetric,
  name: string,
  timeZone = 'UTC',
) {
  return toChartPoints(points, metric, timeZone, (point) => {
    const row = point.rankings.find((entry) => entry.name === name);
    return row ? rankingMetricValue(row, metric) : null;
  });
}

/**
 * One comparison line per tracked competitor, aligned to the same points.
 *
 * Every point already carries the full ranking roster, so nothing is fetched to
 * draw these. A competitor absent from a point contributes a gap there, never a
 * zero: not measured and measured-as-zero are different facts.
 */
export function toCompetitorSeries(
  points: readonly VisibilityTrendPoint[],
  metric: TrendMetric,
  limit = TREND_SERIES_LIMIT,
): TrendSeries[] {
  const latest = points.at(-1);
  const names = (latest?.rankings ?? [])
    .filter((row) => !row.is_brand)
    .sort((a, b) => (b.mention_rate ?? -1) - (a.mention_rate ?? -1))
    .slice(0, limit)
    .map((row) => row.name);
  return names.map((name) => ({
    label: name,
    values: points.map((point) => {
      const row = point.rankings.find((entry) => entry.name === name);
      return row ? rankingMetricValue(row, metric) : null;
    }),
  }));
}
