import type { UseQueryResult } from '@tanstack/react-query';
import { FilterChoice } from '@/components/ui/filter-bar';
import { SegmentedControl } from '@/components/ui/tabs';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { Delta } from '@/components/ui/delta';
import { Stack } from '@/components/ui/layout';
import { InfoHint } from '@/components/ui/info-hint';
import { StateBlock } from '@/components/ui/state-block';
import { AreaChart } from '@/components/ui/area-chart';
import { type TrendSeries } from '@/components/ui/series-data';
import { RankedBrandMark } from '@/components/visibility/ranked-brand-mark';
import { textRole } from '@/components/ui/typography';
import type {
  NetSentiment,
  RankingRow,
  Visibility,
  VisibilityTrendPoint,
} from '@citeladder/contracts';
import { formatPositionExact, formatRate } from '@/lib/visibility/dashboard';
import { sentimentFigureValue } from '@/lib/visibility/perception';
import {
  brandStanding,
  orderByVisibility,
  standingHeadline,
  winRateAbsence,
} from '@/lib/visibility/ranking';
import { useEngineCatalog } from '@/lib/providers/engines';
import {
  toChartPoints,
  toCompetitorSeries,
  toNamedChartPoints,
  toTrendEvents,
  trendAxis,
} from '@/lib/visibility/trends';
import { noObservations } from '@/lib/visibility/vocabulary';
import { selectionBasis } from '@/lib/visibility/coverage';
import { type Absent, formatCount } from '@/lib/format';
import {
  PERCEPTION_MIN_CLASSIFIED,
  SHARE_OF_VOICE_HINT,
  VISIBILITY_METRICS,
  WIN_RATE_HINT,
} from '@/lib/config/visibility';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';

type Metric = (typeof VISIBILITY_METRICS)[number]['value'];

export const metricCodec = stringUrlCodec(
  VISIBILITY_METRICS.map((item) => item.value),
  'brand_mention_rate',
);

const ALL_BRANDS = '__all__';

export function InsightsLede({ selected }: Readonly<{ selected: Visibility }>) {
  const shortfall = selectionBasis(selected);
  const { headline, sub } = standingHeadline(brandStanding(selected.rankings));
  return (
    <Section aria-labelledby="insights-headline">
      <SectionHeader>
        {shortfall ? <p className={textRole('caption')}>{shortfall}</p> : null}
        <h2 id="insights-headline" className={textRole('title')}>
          {headline}
        </h2>
        {sub ? <p className={textRole('body', 'text-ink-2')}>{sub}</p> : null}
      </SectionHeader>
      <Stack>
        <PooledSelectionNote selected={selected} />
        <HeadlineMetrics selected={selected} />
      </Stack>
    </Section>
  );
}

function PooledSelectionNote({ selected }: Readonly<{ selected: Visibility }>) {
  const groups = selected.configuration_groups;
  if (selected.selection_mode !== 'range' || !groups) return null;
  const total = Object.values(groups).reduce((sum, count) => sum + count, 0);
  const pooled = selected.source_audit_ids?.length ?? 0;
  if (Object.keys(groups).length < 2 || pooled >= total) return null;
  return (
    <Notice tone="info">
      {`Counts ${pooled} of ${total} runs; ${total - pooled} used a different setup.`}
    </Notice>
  );
}

function HeadlineMetrics({ selected }: Readonly<{ selected: Visibility }>) {
  const brand = selected.rankings.find((row) => row.is_brand);
  const deltas = selected.comparison?.deltas;
  const unmeasured = noObservations(selected.counts?.state);
  const rate = (key: string, value: number | null | undefined) => {
    const change = deltas?.[key];
    return {
      value: unmeasured ?? formatRate(value ?? null),
      delta: change == null ? null : <Delta value={change} unit=" pp" />,
    };
  };
  const position = brand?.avg_position ?? selected.avg_position ?? null;
  const segments: FigureSegment[] = [
    {
      key: 'visibility',
      label: 'Visibility',
      marker: <InfoHint label="Visibility">The share of answers that name your brand.</InfoHint>,
      ...rate('visibility', selected.visibility_rate),
    },
    ...(brand?.sentiment == null ? [] : [sentimentFigure(brand.sentiment)]),
    ...(position == null
      ? []
      : [
          {
            key: 'avg_position',
            label: 'Position',
            marker: (
              <InfoHint label="Position">
                Where your brand tends to appear among the brands you track, averaged over the
                answers that name you. A brand an answer names that you do not track is not counted.
              </InfoHint>
            ),
            value: formatPositionExact(position),
          },
        ]),
    winRateSegment(brand, unmeasured),
    {
      key: 'sov',
      label: 'Share of voice',
      marker: <InfoHint label="Share of voice">{SHARE_OF_VOICE_HINT}</InfoHint>,
      ...rate('sov', brand?.share_of_voice),
    },
  ];
  return <FigureStrip segments={segments} />;
}

function sentimentFigure(sentiment: NetSentiment): FigureSegment {
  return {
    key: 'sentiment',
    label: 'Sentiment',
    marker: (
      <InfoHint label="Sentiment">
        {`Positive minus negative mentions of your brand, as a share of the classified ones, from −100 to +100. Shows from ${PERCEPTION_MIN_CLASSIFIED} classified mentions.`}
      </InfoHint>
    ),
    ...sentimentFigureValue(sentiment),
    delta: `${sentiment.classified} of ${sentiment.mentions} classified`,
  };
}

function winRateSegment(brand: RankingRow | undefined, unmeasured: Absent | null): FigureSegment {
  const answers = brand?.win_answers ?? null;
  const rate = brand?.win_rate ?? null;
  const wins = brand?.win_count ?? null;
  return {
    key: 'win_rate',
    label: 'Win rate',
    marker: <InfoHint label="Win rate">{WIN_RATE_HINT}</InfoHint>,
    value: unmeasured ?? (rate === null ? null : formatRate(rate)),
    missingState: winRateAbsence(brand),
    delta:
      answers && wins !== null ? (
        <span className={textRole('caption')}>
          {`Named first in ${formatCount(wins)} of ${formatCount(answers)}`}
        </span>
      ) : null,
  };
}

export function BrandTrend({
  query,
  selected,
}: Readonly<{
  query: UseQueryResult<VisibilityTrendPoint[], unknown>;
  selected: Visibility;
}>) {
  const [metric, setMetric] = useUrlState('metric', metricCodec);
  const [focused, setFocused] = useUrlState('brand', optionalStringUrlCodec);
  const brands = orderByVisibility(selected.rankings);
  const focusedBrand = brands.some((row) => row.name === focused) ? focused : null;
  const brandName = selected.rankings.find((row) => row.is_brand)?.name ?? null;
  const focusedIsBrand = focusedBrand !== null && focusedBrand === brandName;
  const lines = (points: readonly VisibilityTrendPoint[], timeZone: string): TrendLines => ({
    name: focusedBrand ?? 'You',
    markName: focusedBrand === null || focusedIsBrand ? null : focusedBrand,
    lead:
      focusedBrand === null || focusedIsBrand
        ? toChartPoints(points, metric, timeZone)
        : toNamedChartPoints(points, metric, focusedBrand, timeZone),
    series: focusedBrand === null ? toCompetitorSeries(points, metric) : [],
  });
  return (
    <Section aria-labelledby="insights-trend">
      <SectionHeader
        actions={
          <>
            <SegmentedControl
              ariaLabel="Plotted metric"
              value={metric}
              options={VISIBILITY_METRICS}
              onChange={setMetric}
            />
            <FilterChoice
              label="Focus"
              value={focusedBrand ?? ALL_BRANDS}
              defaultValue={ALL_BRANDS}
              options={[
                { value: ALL_BRANDS, label: 'All brands' },
                ...brands.map((row) => ({ value: row.name, label: row.name })),
              ]}
              onChange={(value) => setFocused(value === ALL_BRANDS ? null : value)}
            />
          </>
        }
      >
        <SectionTitle id="insights-trend">Your brand over time</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <TrendSection query={query} metric={metric} lines={lines} keyed lonePoint="plot" />
      </SectionContent>
    </Section>
  );
}

export type TrendLines = Readonly<{
  name: string;
  markName: string | null;
  lead: ReturnType<typeof toChartPoints>;
  series: readonly TrendSeries[];
}>;

type TrendSectionProps = Readonly<{
  query: UseQueryResult<VisibilityTrendPoint[], unknown>;
  metric: Metric;
  lines: (points: readonly VisibilityTrendPoint[], timeZone: string) => TrendLines;
  keyed: boolean;
  lonePoint: 'list' | 'plot';
}>;

export function TrendSection({ query, keyed, ...chart }: TrendSectionProps) {
  if (query.isPending)
    return (
      <StateBlock kind="loading" label="Loading the history…" shape={{ kind: 'chart', keyed }} />
    );
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load the history"
        fallback="Check your connection and try again."
      />
    );
  if (!query.data.length)
    return <StateBlock kind="empty" inline message="No runs in this period." />;
  return <TrendChart points={query.data} busy={query.isFetching} {...chart} />;
}

function TrendChart({
  points,
  metric,
  lines,
  lonePoint,
  busy,
}: Omit<TrendSectionProps, 'query' | 'keyed'> &
  Readonly<{ points: readonly VisibilityTrendPoint[]; busy: boolean }>) {
  const timeZone = useDisplayTimeZone();
  const { label: engineLabel } = useEngineCatalog();
  const metricLabel =
    VISIBILITY_METRICS.find((item) => item.value === metric)?.label ?? 'Visibility';
  const { name, markName, lead, series } = lines(points, timeZone);
  const axis = trendAxis(metric, [
    lead.map((point) => point.value),
    ...series.map((line) => line.values),
  ]);
  const chartPoints = lead.map((point) => ({
    ...point,
    value: axis.plot(point.value),
    label: `${point.dateLabel} · ${axis.format(point.value)}`,
    axisLabel: point.label,
  }));
  const events = toTrendEvents(points, { timeZone, engineLabel });
  return (
    <Stack aria-busy={busy}>
      <AreaChart
        label={`${metricLabel} over time`}
        name={name}
        mark={<RankedBrandMark rows={points.at(-1)?.rankings} name={markName} />}
        data={chartPoints}
        series={series.map((line) => ({
          ...line,
          mark: <RankedBrandMark rows={points.at(-1)?.rankings} name={line.label} />,
          values: line.values.map(axis.plot),
        }))}
        events={events}
        eventLegend
        yMin={axis.yMin}
        yMax={axis.yMax}
        yFormat={axis.tick}
        format={(plotted) => axis.format(axis.unplot(plotted))}
        lonePoint={lonePoint}
      />
    </Stack>
  );
}
