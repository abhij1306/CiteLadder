'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import {
  CHART_MARGIN,
  ChartContainer,
  ChartLegend,
  ChartTooltipContent,
  axisProps,
  type ChartConfig,
  type ChartHeight,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

/**
 * Several equally-weighted lines sharing one scale, with a legend.
 *
 * The sibling of `TrendChart`, and separate from it on purpose. That chart has
 * a PRIMARY series with marks, links and version markers, and comparison lines
 * drawn quietly behind it; every affordance the comparisons gave up was given
 * up so the primary could keep it. Here no series is primary — five cited
 * domains are five answers to the same question — so the whole hierarchy that
 * makes `TrendChart` work is the wrong shape, and bolting an "all equal" mode
 * onto it would leave one component answering two questions.
 *
 * Reading a specific value is the legend's and the hover card's job. Hovering
 * a legend entry brings its line forward and dims the rest, which is the
 * comparison a reader actually makes on a five-line chart.
 */

type SeriesPoint = {
  /** Null is unavailable and renders as a gap, never as zero. */
  value: number | null;
  label: string;
};

export type ChartSeries = {
  key: string;
  label: string;
  /** Stroke class from the categorical chart tokens, e.g. `stroke-chart-2`. */
  strokeClass: string;
  /** Matching fill for the legend swatch, e.g. `bg-chart-2`. */
  swatchClass: string;
  /** The same token as a value, for the chart's own colour props. */
  color: string;
  points: readonly SeriesPoint[];
};

/**
 * One row per bucket, every series a column — the shape Recharts reads.
 *
 * A missing measurement is left OFF the row rather than written as null: both
 * break the line, but an absent key also keeps the series out of the hover
 * card for that bucket, which is the honest reading. A bucket nobody measured
 * should not list five sources at nothing.
 */
function toRows(series: readonly ChartSeries[], labels: readonly string[]) {
  return labels.map((label, index) => {
    const row: Record<string, string | number> = { label };
    for (const one of series) {
      const value = one.points[index]?.value;
      if (typeof value === 'number') row[one.key] = value;
    }
    return row;
  });
}

/** What the chart says to a reader who cannot see it. */
function description(
  series: readonly ChartSeries[],
  format: (value: number) => string,
  yAxisLabel?: string,
): string {
  if (!series.length) return 'No sources to chart.';
  const scale = yAxisLabel ? `${yAxisLabel}. ` : '';
  return (
    scale +
    series
      .map((one) => {
        const values = one.points
          .map((point) => point.value)
          .filter((v): v is number => v !== null);
        const first = values[0];
        const last = values.at(-1);
        if (first === undefined || last === undefined) return `${one.label}: not measured`;
        return `${one.label}: from ${format(first)} to ${format(last)}`;
      })
      .join('. ')
  );
}

export function SeriesChart({
  series,
  labels,
  size = 'md',
  domainMax = 100,
  formatTick = (value) => `${Math.round(value)}%`,
  xAxisLabel,
  yAxisLabel,
  className,
}: Readonly<{
  series: readonly ChartSeries[];
  /** One axis label per bucket; every series shares these x positions. */
  labels: readonly string[];
  /** The plot's height role. */
  size?: ChartHeight;
  domainMax?: number;
  formatTick?: (value: number) => string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  className?: string;
}>) {
  const [active, setActive] = useState<string | null>(null);
  const ceiling = domainMax > 0 ? domainMax : 100;
  const config: ChartConfig = Object.fromEntries(
    series.map((one) => [one.key, { label: one.label, color: one.color }]),
  );
  const rows = toRows(series, labels);

  return (
    <div className={cn('grid gap-3', className)}>
      <ChartLegend config={config} active={active} onActivate={setActive} />
      <ChartContainer
        config={config}
        size={size}
        description={description(series, formatTick, yAxisLabel)}
      >
        <LineChart data={rows} margin={CHART_MARGIN}>
          {/* Horizontal only: a vertical rule under every bucket competes with
              the lines it sits behind, and the x tick already places them. */}
          <CartesianGrid vertical={false} className="stroke-border-subtle" />
          <XAxis
            {...axisProps}
            dataKey="label"
            interval="preserveStartEnd"
            minTickGap={24}
            label={
              xAxisLabel
                ? { value: xAxisLabel, position: 'insideBottom', offset: -4, fontSize: 11 }
                : undefined
            }
          />
          <YAxis
            {...axisProps}
            domain={[0, ceiling]}
            tickFormatter={formatTick}
            width={yAxisLabel ? 64 : 44}
            label={
              yAxisLabel
                ? { value: yAxisLabel, angle: -90, position: 'insideLeft', fontSize: 11 }
                : undefined
            }
          />
          <Tooltip
            cursor={{ className: 'stroke-border' }}
            content={<ChartTooltipContent formatValue={formatTick} />}
          />
          {series.map((one) => (
            <Line
              key={one.key}
              type="monotone"
              dataKey={one.key}
              name={one.label}
              stroke={one.color}
              strokeWidth={1.75}
              // A gap stays a gap. Joining across an unmeasured bucket draws a
              // change that was never observed.
              connectNulls={false}
              // A run of one point has no line to draw, so it is drawn as a
              // mark instead. Dropping it made a single-bucket period, and any
              // value sitting alone between two gaps, render as nothing at all
              // -- which reads as "not cited" rather than "cited once".
              dot={{ r: 2.25, fill: one.color, strokeWidth: 0 }}
              activeDot={{ r: 3.5 }}
              isAnimationActive={false}
              opacity={active && active !== one.key ? 0.25 : 1}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}
