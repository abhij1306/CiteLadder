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
import type { TrendEvent, TrendPoint, TrendSeries } from '@/components/ui/series-data';
import type { RankingRow, VisibilityTrendEvent, VisibilityTrendPoint } from '@citeladder/contracts';
import type { VISIBILITY_METRICS } from '@/lib/config/visibility';
import {
  availabilityLabel,
  formatDisplayDate,
  formatDisplayShortDate,
  formattedText,
  formatShortDate,
  formatWindowDate,
  percentText,
  pluralCount,
} from '@/lib/format';
import { formatPositionExact } from '@/lib/visibility/dashboard';
import { formatNet, sentimentReading } from '@/lib/visibility/perception';

export type TrendGranularity = 'run' | 'day' | 'week' | 'month';

export const GRANULARITY_OPTIONS: readonly { value: TrendGranularity; label: string }[] = [
  { value: 'run', label: 'Per run' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
] as const;

export type TrendRange = 'all' | '30d' | '90d' | '1y';

export const RANGE_OPTIONS: readonly { value: TrendRange; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
] as const;

export function rangeToFrom(range: TrendRange, now: Date = new Date()): string | undefined {
  if (range === 'all') return undefined;
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 30);
  else if (range === '90d') from.setUTCDate(from.getUTCDate() - 90);
  else if (range === '1y') from.setUTCFullYear(from.getUTCFullYear() - 1);
  return from.toISOString();
}

export type TrendMetric = (typeof VISIBILITY_METRICS)[number]['value'];

type Plotted = number | null;

export function trendAxis(metric: TrendMetric, lines: readonly (readonly Plotted[])[]) {
  if (metric === 'sentiment')
    return {
      plot: (value: Plotted) => value,
      unplot: (value: number) => value,
      yMin: -100,
      yMax: 100,
      tick: (value: number) => formatNet(value) ?? '',
      format: (value: Plotted) => formatNet(value) ?? availabilityLabel('not_measured'),
    };
  if (metric !== 'avg_position')
    return {
      plot: (value: Plotted) => value,
      unplot: (value: number) => value,
      yMin: undefined,
      yMax: 100,
      tick: (value: number) => `${Math.round(value)}%`,
      format: (value: Plotted) =>
        value === null ? availabilityLabel('not_measured') : percentText(value / 100),
    };
  const values = lines.flat().filter((value): value is number => value !== null);
  return {
    plot: (value: Plotted) => (value === null ? null : -value),
    unplot: (value: number) => -value,
    yMin: -Math.max(2, Math.ceil(Math.max(1, ...values))),
    yMax: -1,
    tick: (value: number) => String(Math.round(-value)),
    format: (value: Plotted) => formattedText(formatPositionExact(value)),
  };
}

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

function metricValue(point: VisibilityTrendPoint, metric: TrendMetric): number | null {
  switch (metric) {
    case 'avg_position':
      return point.avg_position;
    case 'sov':
      return point.sov.mention === null ? null : point.sov.mention * 100;
    case 'brand_mention_rate':
      return point.brand_mention_rate === null ? null : point.brand_mention_rate * 100;
    case 'owned_citation_rate':
      return point.owned_citation_rate === null ? null : point.owned_citation_rate * 100;
    case 'win_rate':
    case 'sentiment': {
      const brand = point.rankings.find((row) => row.is_brand);
      return brand ? rankingMetricValue(brand, metric) : null;
    }
    default: {
      const unhandled: never = metric;
      return unhandled;
    }
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
      value,
      timestamp: new Date(point.completed_at).getTime(),
      breakBefore: changed || identityChanged || !point.comparison_key,
      versionChange:
        changed || point.spans_version_boundary ? { note: versionChangeNote(point) } : null,
    };
  });
}

function versionChangeNote(point: VisibilityTrendPoint): string {
  const scoring = point.scoring_rule_versions.join(', ') || 'unknown';
  return point.spans_version_boundary
    ? `Mixed scoring versions in this bucket (${scoring})`
    : `Scoring rule ${scoring} applied`;
}

const TREND_SERIES_LIMIT = 3;

type RankingMetricRow = Pick<
  RankingRow,
  'mention_rate' | 'citation_rate' | 'share_of_voice' | 'avg_position' | 'win_rate' | 'sentiment'
>;

function rankingMetricValue(row: RankingMetricRow, metric: TrendMetric): number | null {
  const percent = (value: number | null | undefined) => (value == null ? null : value * 100);
  switch (metric) {
    case 'owned_citation_rate':
      return percent(row.citation_rate);
    case 'sov':
      return percent(row.share_of_voice);
    case 'brand_mention_rate':
      return percent(row.mention_rate);
    case 'win_rate':
      return percent(row.win_rate);
    case 'avg_position':
      return row.avg_position;
    case 'sentiment':
      return sentimentReading(row.sentiment).kind === 'value'
        ? (row.sentiment?.net_sentiment ?? null)
        : null;
    default: {
      const unhandled: never = metric;
      return unhandled;
    }
  }
}

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

const EVENT_KIND = {
  prompt_panel: 'panel',
  model_change: 'model',
  action_live: 'action',
} as const satisfies Record<VisibilityTrendEvent['kind'], TrendEvent['kind']>;

function panelText(event: Extract<VisibilityTrendEvent, { kind: 'prompt_panel' }>): string {
  const counts = (
    [
      ['added', event.added],
      ['archived', event.archived],
      ['removed', event.removed],
    ] as const
  ).filter(([, count]) => count > 0);
  const parts = counts.map(([verb, count], index) =>
    index === 0 ? `${pluralCount(count, 'prompt')} ${verb}` : `${count} ${verb}`,
  );
  return `Prompt panel: ${parts.join(', ')}`;
}

function eventText(event: VisibilityTrendEvent, engineLabel: (key: string) => string): string {
  switch (event.kind) {
    case 'prompt_panel':
      return panelText(event);
    case 'model_change':
      return `${engineLabel(event.logical_engine)} model changed: ${event.from_model} → ${event.to_model}`;
    case 'action_live':
      return `Action live: ${event.title}`;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function toTrendEvents(
  points: readonly VisibilityTrendPoint[],
  { timeZone, engineLabel }: Readonly<{ timeZone: string; engineLabel: (key: string) => string }>,
): TrendEvent[] {
  return points.flatMap((point) =>
    point.events.map((event, index) => ({
      key: `${point.completed_at}:${index}`,
      timestamp: new Date(point.completed_at).getTime(),
      kind: EVENT_KIND[event.kind],
      label: `${pointDates(point, timeZone).label} · ${eventText(event, engineLabel)}`,
    })),
  );
}
