'use client';

import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DonutChart } from '@/components/ui/donut-chart';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ReadError } from '@/components/ui/read-error';
import { SeriesChart } from '@/components/ui/series-chart';
import { Skeleton } from '@/components/ui/skeleton';
import { seriesCeiling, toChartSeries, type typeSlices } from '@/lib/visibility/sources';
import type { useSourceAnalysis, useSourceSeries } from '@/lib/visibility/use-source-analysis';
import { cn } from '@/lib/utils';

/**
 * The two cards above the Sources table: usage over time, and the type mix.
 *
 * Split out of the panel because they answer a different question from the
 * table and were half its length. Their states are the load-bearing part: each
 * one is a fixed box, so a filter that empties the chart cannot shorten the
 * card and move the table underneath it.
 */

/** The usage-over-time chart, and the states it can be in instead. */
export function UsageCard({
  dimension,
  query,
  heading,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceSeries>;
  /** A single page's own line titles itself; the inventory's names its leaders. */
  heading?: { title: string; description: string };
}>) {
  const series = toChartSeries(query.data);
  const urls = dimension === 'url';
  return (
    <Card className="relative">
      <BusyBar active={query.isFetching} label="Updating usage" />
      <CardHeader>
        <CardTitle>
          {heading?.title ?? (urls ? 'Source usage by URL' : 'Source usage by domain')}
        </CardTitle>
        <CardDescription>
          {heading?.description ??
            `How often each of the leading ${urls ? 'pages' : 'domains'} was used as a source, as a share of the answers in each period.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UsagePlot query={query} series={series} />
      </CardContent>
    </Card>
  );
}

/**
 * The box every state of the usage card occupies: the page-chart height role,
 * which holds the legend (up to two wrapped lines) above the 260px plot.
 */
const USAGE_PLOT_BOX = 'min-h-[var(--chart-height-lg)]';

/** The plot, or the one state standing in for it. */
function UsagePlot({
  query,
  series,
}: Readonly<{
  query: ReturnType<typeof useSourceSeries>;
  series: ReturnType<typeof toChartSeries>;
}>) {
  // Every state occupies the same box. The plot is 260px and the legend above
  // it wraps to one or two lines, so a state of another height moved the table
  // below this card every time a filter changed.
  if (query.isError) {
    return (
      <div className={USAGE_PLOT_BOX}>
        <ReadError
          error={query.error}
          fallback="Could not load source usage."
          onRetry={() => void query.refetch()}
          pending={query.isFetching}
        />
      </div>
    );
  }
  if (query.isLoading) return <Skeleton className={cn(USAGE_PLOT_BOX, 'w-full')} />;
  if (!series.length) {
    return (
      <div className={cn(USAGE_PLOT_BOX, 'grid place-items-center')}>
        <InlineEmpty>No sources were used in this period.</InlineEmpty>
      </div>
    );
  }
  return (
    <SeriesChart
      series={series}
      labels={(query.data?.buckets ?? []).map(bucketLabel)}
      domainMax={seriesCeiling(series)}
      yAxisLabel="Share of answers"
      className={USAGE_PLOT_BOX}
    />
  );
}

/** The ring, its centre total and its legend: the default chart height role. */
const TYPES_RING_BOX = 'h-[var(--chart-height-md)]';

/** The citation mix, counted server-side over the whole selection. */
export function TypesCard({
  slices,
  total,
  query,
}: Readonly<{
  slices: ReturnType<typeof typeSlices>;
  total: number;
  query: ReturnType<typeof useSourceAnalysis>['sourceQuery'];
}>) {
  return (
    <Card className="relative">
      <BusyBar active={query.isFetching} label="Updating source types" />
      <CardHeader>
        <CardTitle>Source types</CardTitle>
      </CardHeader>
      <CardContent>
        <TypesRing slices={slices} total={total} query={query} />
      </CardContent>
    </Card>
  );
}

/** The ring, or the one state standing in for it. */
function TypesRing({
  slices,
  total,
  query,
}: Readonly<{
  slices: ReturnType<typeof typeSlices>;
  total: number;
  query: ReturnType<typeof useSourceAnalysis>['sourceQuery'];
}>) {
  // A failed read is not an empty mix. Drawing the empty ring here reported
  // "no citations in this selection" for a request that never answered.
  if (query.isError) {
    return (
      <div className={TYPES_RING_BOX}>
        <ReadError
          error={query.error}
          fallback="Could not load source types."
          onRetry={() => void query.refetch()}
          pending={query.isFetching}
        />
      </div>
    );
  }
  if (query.isLoading) return <Skeleton className={cn(TYPES_RING_BOX, 'w-full')} />;
  return (
    <DonutChart
      slices={slices}
      total={total}
      totalLabel="Citations"
      emptyLabel="No citations in this selection."
    />
  );
}

/** A bucket boundary as an axis tick — the date, never the time. */
function bucketLabel(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? value
    : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
