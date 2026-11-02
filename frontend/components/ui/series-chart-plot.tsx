'use client';

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

import { CHART_MARGIN, ChartTooltipContent, axisProps } from '@/components/ui/chart';
import { ChartPlot } from '@/components/ui/chart-plot';
import type { ChartSeries } from '@/components/ui/series-chart';

/**
 * The drawing inside `SeriesChart`, loaded on its own so Recharts is fetched
 * when the chart is drawn rather than with the screen.
 */
export function SeriesPlot({
  rows,
  series,
  ceiling,
  formatTick,
  xAxisLabel,
  yAxisLabel,
  active,
}: Readonly<{
  rows: Record<string, string | number>[];
  series: readonly ChartSeries[];
  ceiling: number;
  formatTick: (value: number) => string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  /** The legend entry being read, whose line stays forward. */
  active: string | null;
}>) {
  return (
    <ChartPlot>
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
    </ChartPlot>
  );
}
