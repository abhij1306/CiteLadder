import type { UseQueryResult } from '@tanstack/react-query';

import { BusyRung } from '@/components/ui/rung-meter';
import { ChartFrame } from '@/components/ui/chart-frame';
import { Skeleton } from '@/components/ui/skeleton';
import { PartDonut, type Part } from '@/components/ui/part-donut';
import { AreaChart } from '@/components/ui/area-chart';
import { type TrendSeries } from '@/components/ui/series-data';
import { BrandMark } from '@/components/ui/brand-mark';
import { formatDisplayShortDate } from '@/lib/format';
import { hostOf, seriesCeiling, toChartSeries, type typeSlices } from '@/lib/visibility/sources';
import type { useSourceSeries } from '@/lib/visibility/use-source-analysis';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';

export function UsageCard({
  dimension,
  query,
  heading,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceSeries>;
  heading?: string;
}>) {
  const urls = dimension === 'url';
  const title = heading ?? (urls ? 'Source usage by URL' : 'Source usage by domain');
  return (
    <Section className="relative">
      <BusyRung active={query.isFetching} label="Updating usage" />
      <SectionHeader>
        <SectionTitle>{title}</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <ChartFrame height={query.data?.buckets.length === 1 ? undefined : 'lg'}>
          <UsagePlot query={query} label={title} />
        </ChartFrame>
      </SectionContent>
    </Section>
  );
}

const percentLabel = (value: number) => `${Math.round(value)}%`;

function UsagePlot({
  query,
  label,
}: Readonly<{ query: ReturnType<typeof useSourceSeries>; label: string }>) {
  if (query.isError) {
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load source usage"
        fallback="The request failed or timed out."
      />
    );
  }
  if (query.isPending) return <Skeleton variant="chart" />;
  const series = toChartSeries(query.data);
  const [first, ...rest] = series;
  if (!first) {
    return (
      <div className="grid place-items-center">
        <StateBlock kind="empty" inline message="No sources were used in this period." />
      </div>
    );
  }
  return (
    <AreaChart
      label={label}
      name={first.label}
      mark={<SourceMark source={first.key} />}
      data={(query.data?.buckets ?? []).map((bucket, index) => ({
        label: bucketLabel(bucket),
        value: first.points[index]?.value ?? null,
      }))}
      series={usageComparisons(rest)}
      you={false}
      yMin={0}
      yMax={seriesCeiling(series)}
      yFormat={percentLabel}
    />
  );
}

type UsageLine = ReturnType<typeof toChartSeries>[number];

function SourceMark({ source }: Readonly<{ source: string }>) {
  const host = source.includes('/') ? hostOf(source) : source;
  return (
    <BrandMark
      name={host ?? source}
      websiteUrl={host ? `https://${host}` : null}
      placement="inline"
    />
  );
}

function usageComparisons(lines: readonly UsageLine[]): TrendSeries[] {
  const named = lines.length > 3 ? lines.slice(0, 2) : lines;
  const merged = lines.length > 3 ? lines.slice(2) : [];
  const values = (line: UsageLine) => line.points.map((point) => point.value);
  const comparisons: TrendSeries[] = named.map((line) => ({
    label: line.label,
    mark: <SourceMark source={line.key} />,
    values: values(line),
  }));
  if (!merged.length) return comparisons;
  const width = Math.max(...merged.map((line) => line.points.length));
  const other = Array.from({ length: width }, (_, index) => {
    const measured = merged
      .map((line) => line.points[index]?.value)
      .filter((value): value is number => typeof value === 'number');
    return measured.length ? measured.reduce((sum, value) => sum + value, 0) : null;
  });
  return [...comparisons, { label: 'Other', values: other, other: true }];
}

type TypeSlice = ReturnType<typeof typeSlices>[number];

const OTHER_TYPES = new Set(['other_third_party', 'unresolved']);

function typeSegments(slices: readonly TypeSlice[]): Part[] {
  const own = slices.filter((slice) => slice.key === 'brand_owned');
  const ranked = slices
    .filter((slice) => slice.key !== 'brand_owned' && !OTHER_TYPES.has(slice.key))
    .sort((left, right) => right.value - left.value);
  const named = [...own, ...ranked];
  const others = slices.filter((slice) => OTHER_TYPES.has(slice.key));
  const room = others.length ? 3 : 4;
  const kept = named.length > room ? named.slice(0, 3) : named;
  const folded = [...named.slice(kept.length), ...others];
  const parts: Part[] = kept.map((slice) => ({
    label: slice.label,
    value: slice.value,
    you: slice.key === 'brand_owned',
  }));
  if (!folded.length) return parts;
  const value = folded.reduce((sum, slice) => sum + slice.value, 0);
  return [...parts, { label: 'Other', value, other: true }];
}

type ReadState = Pick<
  UseQueryResult<unknown>,
  'error' | 'isError' | 'isFetching' | 'isPending' | 'refetch'
>;

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
    <Section className="relative">
      <BusyRung active={query.isFetching} label="Updating source types" />
      <SectionHeader>
        <SectionTitle>Source types</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <ChartFrame height="md">
          <TypesMix slices={slices} total={total} query={query} />
        </ChartFrame>
      </SectionContent>
    </Section>
  );
}

function TypesMix({
  slices,
  total,
  query,
}: Readonly<{
  slices: ReturnType<typeof typeSlices>;
  total: number;
  query: ReadState;
}>) {
  if (query.isError) {
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load source types"
        fallback="The request failed or timed out."
      />
    );
  }
  if (query.isPending) return <Skeleton variant="chart" />;
  if (!slices.length && total <= 0) {
    return (
      <div className="grid place-items-center">
        <StateBlock kind="empty" inline message="No citations in this selection." />
      </div>
    );
  }
  return (
    <PartDonut
      parts={typeSegments(slices)}
      total={total}
      totalLabel="citations"
      remainderLabel="Unclassified"
      label="Source types"
    />
  );
}

function bucketLabel(value: string): string {
  return formatDisplayShortDate(value, 'UTC');
}
