'use client';

import { lazy, useState } from 'react';

import {
  ChartContainer,
  ChartLegend,
  type ChartConfig,
  type ChartHeight,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

// The drawing is fetched when a chart is drawn; the legend and the plot's box
// render at once, so the plot arrives in a space already held.
const SeriesPlot = lazy(() =>
  import('./series-chart-plot').then(({ SeriesPlot }) => ({ default: SeriesPlot })),
);

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
        <SeriesPlot
          rows={rows}
          series={series}
          ceiling={ceiling}
          formatTick={formatTick}
          xAxisLabel={xAxisLabel}
          yAxisLabel={yAxisLabel}
          active={active}
        />
      </ChartContainer>
    </div>
  );
}
