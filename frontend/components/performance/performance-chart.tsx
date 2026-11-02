'use client';

import { lazy } from 'react';

import { ChartContainer, LegendSwatch, type ChartConfig } from '@/components/ui/chart';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import {
  axisDomainMax,
  formatAxisTick,
  isInvertedMetric,
  seriesMax,
  type PerformanceChartPoint,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';

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
 *
 * The drawing (`performance-chart-plot.tsx`) is fetched when the chart is
 * drawn; the plot's box and the legend render at once, so it arrives in a
 * space already held.
 */

export type ChartSeries = {
  key: PerformanceMetricKey;
  label: string;
  /** Token-driven stroke, one per metric. */
  color: string;
  selected: PerformanceChartPoint[];
  comparison: PerformanceChartPoint[] | null;
};

const PerformancePlot = lazy(() =>
  import('./performance-chart-plot').then(({ PerformancePlot }) => ({
    default: PerformancePlot,
  })),
);

function domainFor(series: ChartSeries): [number, number] {
  const max = seriesMax(series.selected, series.comparison ?? []);
  // Rank charts read best from 1 at the top down to a nice ceiling.
  return [0, axisDomainMax(isInvertedMetric(series.key) ? Math.max(max, 1) : max)];
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
    return <QueryState kind="empty" inline message={summary} />;
  }

  // Axis dates come from the LONGEST selected series, never the first
  // non-empty one: columnCount spans comparisons too, so a shorter first
  // series left the tail of the axis with no date for its index.
  const axisEntry = series.reduce<ChartSeries | null>(
    (longest, entry) =>
      longest === null || entry.selected.length > longest.selected.length ? entry : longest,
    null,
  );
  const config: ChartConfig = Object.fromEntries(
    series.map((entry) => [entry.key, { label: entry.label, color: entry.color }]),
  );
  const domains = new Map(
    series.map((entry): [PerformanceMetricKey, [number, number]] => [entry.key, domainFor(entry)]),
  );

  return (
    <Stack gap="compact" className={className}>
      <ChartContainer config={config} description={summary}>
        <PerformancePlot
          series={series}
          columnCount={columnCount}
          domains={domains}
          axisEntry={axisEntry}
        />
      </ChartContainer>

      <Inline as="ul" gap="meta">
        {series.map((entry) => (
          <Inline as="li" key={entry.key} className="type-caption">
            <LegendSwatch color={entry.color} shape="line" />
            {entry.label}
            <span className="tabular-nums">0–{formatAxisTick(entry.key, domainFor(entry)[1])}</span>
          </Inline>
        ))}
      </Inline>
    </Stack>
  );
}
