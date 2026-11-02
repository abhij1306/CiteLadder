'use client';

import { Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import { CHART_MARGIN, ChartTooltipPanel, LegendSwatch, axisProps } from '@/components/ui/chart';
import { ChartPlot } from '@/components/ui/chart-plot';
import { Inline, Stack } from '@/components/ui/layout';
import { formatShortDate } from '@/lib/format';
import {
  computeTickIndices,
  formatMetric,
  isInvertedMetric,
  type PerformanceChartPoint,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';

import type { ChartSeries } from './performance-chart';

const COMPARISON_SUFFIX = '__comparison';

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

/**
 * The drawing inside `PerformanceChart`, loaded on its own so Recharts is
 * fetched when the chart is drawn rather than with the screen. The domains
 * and axis dates arrive from the chart, which shares them with its legend.
 */
export function PerformancePlot({
  series,
  columnCount,
  domains,
  axisEntry,
}: Readonly<{
  series: readonly ChartSeries[];
  columnCount: number;
  /** Each metric's own value domain, by metric key. */
  domains: ReadonlyMap<PerformanceMetricKey, [number, number]>;
  /** The longest selected series, which labels the axis and the hover card. */
  axisEntry: ChartSeries | null;
}>) {
  const axisPoints: readonly PerformanceChartPoint[] = axisEntry?.selected ?? [];
  return (
    <ChartPlot>
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
            domain={domains.get(entry.key)}
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
    </ChartPlot>
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
    <ChartTooltipPanel className="type-caption">
      <Stack gap="tight">
        <p className="type-badge">
          Day <span className="tabular-nums">{index + 1}</span>
          {selectedDate ? ` · ${selectedDate}` : ''}
        </p>
        <Stack as="ul" gap="tight">
          {series.map((entry) => (
            <Inline as="li" key={entry.key}>
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
            </Inline>
          ))}
        </Stack>
        {comparisonDate ? <p>Comparison day · {comparisonDate}</p> : null}
      </Stack>
    </ChartTooltipPanel>
  );
}
