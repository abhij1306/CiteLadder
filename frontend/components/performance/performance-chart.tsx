'use client';

import { Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import {
  CHART_MARGIN,
  ChartContainer,
  ChartTooltipPanel,
  LegendSwatch,
  axisProps,
  type ChartConfig,
} from '@/components/ui/chart';
import { InlineEmpty } from '@/components/ui/inline-empty';
import {
  axisDomainMax,
  computeTickIndices,
  formatAxisTick,
  formatMetric,
  isInvertedMetric,
  seriesMax,
  type PerformanceChartPoint,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';
import { formatShortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The combined Performance chart: every selected GSC metric on one hoverable
 * plot, with its comparison window drawn dashed beside it.
 *
 * Two decisions carry the design:
 *
 * 1. The x-axis is POSITIONAL (day 1..N), not dated. A comparison window
 *    covers different calendar dates than the selection, so position is the
 *    only honest shared axis; each point keeps its own real date for the
 *    tooltip.
 * 2. Each metric gets its OWN value domain — a hidden y-axis per series.
 *    Clicks and impressions differ by orders of magnitude, and CTR is a
 *    fraction while position is a rank — a shared axis would flatten every
 *    series but the largest into a straight line. Position additionally
 *    inverts, because a smaller rank is better.
 *
 * A null bucket is an unmeasured one: the line breaks there rather than
 * dropping to zero.
 */

export type ChartSeries = {
  key: PerformanceMetricKey;
  label: string;
  /** Token-driven stroke, one per metric. */
  color: string;
  selected: PerformanceChartPoint[];
  comparison: PerformanceChartPoint[] | null;
};

const COMPARISON_SUFFIX = '__comparison';

function domainFor(series: ChartSeries): [number, number] {
  const max = seriesMax(series.selected, series.comparison ?? []);
  // Rank charts read best from 1 at the top down to a nice ceiling.
  return [0, axisDomainMax(isInvertedMetric(series.key) ? Math.max(max, 1) : max)];
}

/**
 * One row per position, each series (and its comparison) a column. An
 * unmeasured bucket is left OFF the row: the line breaks there and the hover
 * card does not list it at zero.
 */
function toRows(series: readonly ChartSeries[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => {
    const row: Record<string, number> = { index };
    for (const entry of series) {
      const value = entry.selected[index]?.value;
      if (typeof value === 'number') row[entry.key] = value;
      const comparison = entry.comparison?.[index]?.value;
      if (typeof comparison === 'number') row[entry.key + COMPARISON_SUFFIX] = comparison;
    }
    return row;
  });
}

function chartSummary(series: readonly ChartSeries[], columnCount: number): string {
  if (!series.length) return 'No metrics selected';
  if (!columnCount) return 'No measured buckets in the selected range';
  const names = series.map((entry) => entry.label).join(', ');
  return `${names} over ${columnCount} day${columnCount === 1 ? '' : 's'}${
    series.some((entry) => entry.comparison) ? ', with comparison period' : ''
  }`;
}

export function PerformanceChart({
  series,
  className,
}: Readonly<{ series: readonly ChartSeries[]; className?: string }>) {
  const columnCount = series.reduce(
    (max, entry) => Math.max(max, entry.selected.length, entry.comparison?.length ?? 0),
    0,
  );
  const summary = chartSummary(series, columnCount);

  if (!series.length || columnCount === 0) {
    // Nothing is plotted, so the plot's height is not reserved. A tall empty
    // box read as a broken chart rather than an absent one. The line still
    // states which absence this is.
    return <InlineEmpty className={cn('min-h-18', className)}>{summary}</InlineEmpty>;
  }

  // Axis dates come from the LONGEST selected series, never the first
  // non-empty one: columnCount spans comparisons too, so a shorter first
  // series left the tail of the axis with no date for its index.
  const axisEntry = series.reduce<ChartSeries | null>(
    (longest, entry) =>
      longest === null || entry.selected.length > longest.selected.length ? entry : longest,
    null,
  );
  const axisPoints: readonly PerformanceChartPoint[] = axisEntry?.selected ?? [];
  const config: ChartConfig = Object.fromEntries(
    series.map((entry) => [entry.key, { label: entry.label, color: entry.color }]),
  );

  return (
    <div className={cn('grid gap-2', className)}>
      <ChartContainer config={config} size="md" description={summary}>
        <LineChart data={toRows(series, columnCount)} margin={CHART_MARGIN}>
          <XAxis
            {...axisProps}
            dataKey="index"
            ticks={computeTickIndices(columnCount, 6)}
            interval={0}
            // No date for this bucket means the selected window does not reach
            // it (a comparison runs longer). An unlabelled tick is honest; a
            // position number pretending to be a date is not.
            tickFormatter={(index: number) => {
              const date = axisPoints[index]?.date;
              return date ? formatShortDate(date) : '';
            }}
          />
          {series.map((entry) => (
            <YAxis
              key={entry.key}
              yAxisId={entry.key}
              hide
              domain={domainFor(entry)}
              reversed={isInvertedMetric(entry.key)}
            />
          ))}
          <Tooltip
            cursor={{ className: 'stroke-border' }}
            content={<ChartTooltip series={series} dateSource={axisEntry} />}
          />
          {series.flatMap((entry) => [
            <Line
              key={entry.key + COMPARISON_SUFFIX}
              yAxisId={entry.key}
              dataKey={entry.key + COMPARISON_SUFFIX}
              name={`${entry.label} (comparison)`}
              stroke={entry.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.65}
              connectNulls={false}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />,
            <Line
              key={entry.key}
              yAxisId={entry.key}
              dataKey={entry.key}
              name={entry.label}
              stroke={entry.color}
              strokeWidth={2}
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />,
          ])}
        </LineChart>
      </ChartContainer>

      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <li key={entry.key} className="type-caption flex items-center gap-2">
            <LegendSwatch color={entry.color} shape="line" />
            {entry.label}
            <span className="tabular-nums">0–{formatAxisTick(entry.key, domainFor(entry)[1])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hover readout. Shows each selected metric's value at this position and,
 * when a comparison is active, the comparison bucket's own date and value —
 * so a dashed point is never ambiguous about which day it represents.
 * Recharts injects `active` and the hovered `label`, which is the bucket index.
 */
function ChartTooltip({
  active,
  label: index,
  series,
  dateSource,
}: Readonly<{
  active?: boolean;
  label?: unknown;
  series: readonly ChartSeries[];
  /**
   * The series the AXIS labels its dates from, so the tooltip never reads a
   * date from a shorter series than the axis does.
   */
  dateSource: ChartSeries | null;
}>) {
  if (!active || typeof index !== 'number') return null;
  const selectedDate = dateSource?.selected[index]?.date ?? null;
  const comparisonDate = dateSource?.comparison?.[index]?.date ?? null;
  return (
    <ChartTooltipPanel className="type-caption grid gap-1">
      <p className="type-badge">
        Day <span className="tabular-nums">{index + 1}</span>
        {selectedDate ? ` · ${selectedDate}` : ''}
      </p>
      <ul className="grid gap-0.5">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2">
            <LegendSwatch color={entry.color} shape="line" />
            <span>{entry.label}</span>
            <span className="tabular-nums">
              {formatMetric(entry.key, entry.selected[index]?.value ?? null)}
            </span>
            {entry.comparison ? (
              <span className="tabular-nums">
                vs {formatMetric(entry.key, entry.comparison[index]?.value ?? null)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {comparisonDate ? <p>Comparison day · {comparisonDate}</p> : null}
    </ChartTooltipPanel>
  );
}
