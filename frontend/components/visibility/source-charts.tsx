import type { UseQueryResult } from '@tanstack/react-query';

import { BusyBar } from '@/components/ui/progress-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartFrame } from '@/components/ui/chart';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { DonutChart, type DonutSlice } from '@/components/ui/donut-chart';
import { TrendChart, type TrendSeries } from '@/components/ui/trend-chart';
import { seriesCeiling, toChartSeries, type typeSlices } from '@/lib/visibility/sources';
import type { useSourceSeries } from '@/lib/visibility/use-source-analysis';

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
  const urls = dimension === 'url';
  const title = heading?.title ?? (urls ? 'Source usage by URL' : 'Source usage by domain');
  return (
    <Card className="relative">
      <BusyBar active={query.isFetching} label="Updating usage" />
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {heading?.description ??
            `How often each of the leading ${urls ? 'pages' : 'domains'} was used as a source, as a share of the answers in each period.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Every state occupies the page-chart box, which holds the legend
            (up to two wrapped lines) above the plot, so a state of another
            height never moves the table below this card. */}
        <ChartFrame height="lg">
          <UsagePlot query={query} label={title} />
        </ChartFrame>
      </CardContent>
    </Card>
  );
}

const percentLabel = (value: number) => `${Math.round(value)}%`;

/** The plot, or the one state standing in for it. */
function UsagePlot({
  query,
  label,
}: Readonly<{ query: ReturnType<typeof useSourceSeries>; label: string }>) {
  if (query.isError) {
    return (
      <ReadError
        error={query.error}
        fallback="Could not load source usage."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  }
  // Pending, not merely loading: a read still waiting on its run fetches
  // nothing and has no data, which is not "no sources were used".
  if (query.isPending) return <Skeleton variant="chart" />;
  const series = toChartSeries(query.data);
  const [first, ...rest] = series;
  if (!first) {
    return (
      <div className="grid place-items-center">
        <QueryState kind="empty" inline message="No sources were used in this period." />
      </div>
    );
  }
  return (
    <TrendChart
      label={label}
      name={first.label}
      data={(query.data?.buckets ?? []).map((bucket, index) => ({
        label: bucketLabel(bucket),
        value: first.points[index]?.value ?? null,
      }))}
      series={usageComparisons(rest)}
      yMin={0}
      yMax={seriesCeiling(series)}
      yFormat={percentLabel}
    />
  );
}

type UsageLine = ReturnType<typeof toChartSeries>[number];

/**
 * The lines after the first, at most three: past that, the remaining sources
 * fold into one Other line. Other is the sum of their shares, so where one
 * answer used several of them it counts that answer once per source.
 */
function usageComparisons(lines: readonly UsageLine[]): TrendSeries[] {
  const named = lines.length > 3 ? lines.slice(0, 2) : lines;
  const merged = lines.length > 3 ? lines.slice(2) : [];
  const values = (line: UsageLine) => line.points.map((point) => point.value);
  const comparisons: TrendSeries[] = named.map((line) => ({
    label: line.label,
    values: values(line),
  }));
  if (!merged.length) return comparisons;
  const width = Math.max(...merged.map((line) => line.points.length));
  const other = Array.from({ length: width }, (_, index) => {
    const measured = merged
      .map((line) => line.points[index]?.value)
      .filter((value): value is number => typeof value === 'number');
    // Unmeasured in every merged source stays unmeasured, never a zero.
    return measured.length ? measured.reduce((sum, value) => sum + value, 0) : null;
  });
  return [...comparisons, { label: 'Other', values: other, other: true }];
}

type TypeSlice = ReturnType<typeof typeSlices>[number];

/** The type tokens that already mean "other", folded into the Other part. */
const OTHER_TYPES = new Set(['other_third_party', 'unresolved']);

/**
 * At most four parts of the type mix: your own domains first, then the
 * largest types, and the rest (with the types that already read "Other")
 * merged into one Other part, so a long taxonomy never becomes nine slivers.
 */
function typeSegments(slices: readonly TypeSlice[]): DonutSlice[] {
  const own = slices.filter((slice) => slice.key === 'brand_owned');
  const ranked = slices
    .filter((slice) => slice.key !== 'brand_owned' && !OTHER_TYPES.has(slice.key))
    .sort((left, right) => right.value - left.value);
  const named = [...own, ...ranked];
  const others = slices.filter((slice) => OTHER_TYPES.has(slice.key));
  const room = others.length ? 3 : 4;
  const kept = named.length > room ? named.slice(0, 3) : named;
  const folded = [...named.slice(kept.length), ...others];
  const parts: DonutSlice[] = kept.map((slice) => ({ name: slice.label, value: slice.value }));
  if (!folded.length) return parts;
  const value = folded.reduce((sum, slice) => sum + slice.value, 0);
  return [...parts, { name: 'Other', value, other: true }];
}

type ReadState = Pick<
  UseQueryResult<unknown>,
  'error' | 'isError' | 'isFetching' | 'isPending' | 'refetch'
>;

/** The citation mix, counted server-side over the whole selection. */
export function TypesCard({
  slices,
  total,
  query,
}: Readonly<{
  slices: ReturnType<typeof typeSlices>;
  total: number;
  query: ReadState;
}>) {
  return (
    <Card className="relative">
      <BusyBar active={query.isFetching} label="Updating source types" />
      <CardHeader>
        <CardTitle>Source types</CardTitle>
      </CardHeader>
      <CardContent>
        {/* The donut and its legend in the default chart height role. */}
        <ChartFrame height="md">
          <TypesMix slices={slices} total={total} query={query} />
        </ChartFrame>
      </CardContent>
    </Card>
  );
}

/** The mix, or the one state standing in for it. */
function TypesMix({
  slices,
  total,
  query,
}: Readonly<{
  slices: ReturnType<typeof typeSlices>;
  total: number;
  query: ReadState;
}>) {
  // A failed read is not an empty mix. Drawing an empty mix here reported
  // "no citations in this selection" for a request that never answered.
  if (query.isError) {
    return (
      <ReadError
        error={query.error}
        fallback="Could not load source types."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  }
  if (query.isPending) return <Skeleton variant="chart" />;
  if (!slices.length && total <= 0) {
    return (
      <div className="grid place-items-center">
        <QueryState kind="empty" inline message="No citations in this selection." />
      </div>
    );
  }
  // The whole is the DECLARED total, never the parts' own sum: citations whose
  // page was never classified are counted in it and belong to no type, so
  // they stay an unfilled remainder instead of stretching the types to 100%.
  return (
    <DonutChart
      slices={typeSegments(slices)}
      total={total}
      totalLabel="Citations"
      remainderLabel="Unclassified"
      label="Source types"
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
