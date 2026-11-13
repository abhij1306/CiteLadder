import type { UseQueryResult } from '@tanstack/react-query';
import { FilterChoice } from '@/components/ui/filter-bar';
import { Callout } from '@/components/ui/callout';
import { Button } from '@/components/ui/button';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { AppGrid } from '@/components/ui/app-grid';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { Stack } from '@/components/ui/layout';
import { InfoHint } from '@/components/ui/info-hint';
import { ReadError } from '@/components/ui/read-error';
import { KpiRow, type StatSegment } from '@/components/ui/stat-row';
import { TrendChart } from '@/components/ui/trend-chart';
import { textRole } from '@/components/ui/typography';
import { RankingRowsTable } from '@/components/visibility/ranking-rows';
import { EngineComparison } from '@/components/visibility/engine-comparison';
import { SurfaceRatesPanel } from '@/components/visibility/surface-rates';
import type { SurfaceRates, Visibility, VisibilityTrendPoint } from '@citeladder/contracts';
import {
  formatPosition,
  formatPositionExact,
  formatRate,
  formatWholePercent,
  type VisibilityFilters,
} from '@/lib/visibility/dashboard';
import { toChartPoints, toCompetitorSeries, toNamedChartPoints } from '@/lib/visibility/trends';
import { observationLabel } from '@/lib/visibility/vocabulary';
import { coverageSummary } from '@/lib/visibility/coverage';
import { formatDisplayDate } from '@/lib/format';
import { VISIBILITY_METRICS } from '@/lib/config/visibility';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

/** The headline mean place in answers, named apart from the table's Rank. */
const AVERAGE_POSITION = 'Average position in answers';

const metricCodec = stringUrlCodec(
  VISIBILITY_METRICS.map((item) => item.value),
  'brand_mention_rate',
);

export function VisibilityTrends({
  query,
  selected,
  selectionBusy,
  engineFilter,
  surfaceRatesQuery,
  surfaceEngine,
  onEvidence,
}: Readonly<{
  query: UseQueryResult<VisibilityTrendPoint[], unknown>;
  /** The measured selection, once `SelectionGate` has settled it. */
  selected: Visibility;
  /** The selection is refetching under a newer filter. */
  selectionBusy: boolean;
  engineFilter: VisibilityFilters['engine'];
  surfaceRatesQuery: UseQueryResult<SurfaceRates, unknown>;
  /** Non-null only while the surface filter names an observed surface. */
  surfaceEngine: string | null;
  hasRuns: boolean;
  isFiltered: boolean;
  onEvidence?: (slice: Record<string, string | null>) => void;
}>) {
  const [metric, setMetric] = useUrlState('metric', metricCodec);
  // Which single brand the chart is plotting, or null for the default roster.
  // URL-held so a focused comparison survives a reload and can be linked to.
  const [focused, setFocused] = useUrlState('brand', optionalStringUrlCodec);
  // A `brand` carried in from another run's URL may name nobody in THIS
  // selection. Plotting it anyway drew an empty chart captioned with a brand
  // the run never measured, which reads as "measured, scored zero". An
  // unrecognized name falls back to the full roster.
  const focusedBrand =
    focused !== null && selected.rankings.some((row) => row.name === focused) ? focused : null;
  const rankingTable = (
    <RankingRowsTable rows={selected.rankings} onSelect={setFocused} selectedName={focusedBrand} />
  );
  return (
    <Stack gap="workspace" aria-busy={selectionBusy}>
      <PooledSelectionNote selected={selected} />
      <HeadlineMetrics selected={selected} />
      <CoverageStrip selected={selected} />
      {/* Only when the reader has narrowed to the observed surface. These
          rates divide by observations, not by answers, so showing them beside
          an unfiltered cross-surface view would invite reading them as the
          whole product's numbers. */}
      {surfaceEngine ? <SurfaceRatesPanel query={surfaceRatesQuery} /> : null}
      {/* The trend sits beside the table once there is one to draw (owner,
          2026-11-10): a single period has no line, so the table takes the
          row. A failed history read keeps its card, so it can be retried.
          The table takes five ninths of the row, so every brand keeps its
          name beside its figure columns from 1280px, and the chart keeps four
          ninths for its lines (an even split cut the names to their logos;
          three fifths left the chart cramped, owner 2026-11-11). */}
      {hasTrend(query) ? (
        <AppGrid layout="table-chart">
          {rankingTable}
          <MeasurementHistory
            query={query}
            metric={metric}
            setMetric={setMetric}
            focused={focusedBrand}
            onClearFocus={() => setFocused(null)}
            brandName={selected.rankings.find((row) => row.is_brand)?.name ?? null}
          />
        </AppGrid>
      ) : (
        rankingTable
      )}
      <EngineComparison
        visibility={selected}
        filter={engineFilter}
        onSelect={
          onEvidence ? (engine) => onEvidence({ run: selected.audit_id, engine }) : undefined
        }
      />
    </Stack>
  );
}

/** Whether the history has a line to draw (two periods or more), or a failure to report. */
function hasTrend(query: UseQueryResult<VisibilityTrendPoint[], unknown>): boolean {
  return query.isError || (query.data?.length ?? 0) > 1;
}

/**
 * What "All runs in period" actually pooled.
 *
 * Runs are only comparable within one frozen configuration, so pooling a period
 * takes the runs of a single configuration — the most recent one — and leaves
 * the rest out. That is the right measurement and the wrong silence: a reader
 * who ran the same prompts against three model line-ups sees a number drawn
 * from one of them under a chip that says "all runs", with no way to tell that
 * runs were dropped or that the dropped ones scored differently.
 */
function PooledSelectionNote({ selected }: Readonly<{ selected: Visibility }>) {
  const groups = selected.configuration_groups;
  if (selected.selection_mode !== 'range' || !groups) return null;
  const total = Object.values(groups).reduce((sum, count) => sum + count, 0);
  const pooled = selected.source_audit_ids?.length ?? 0;
  if (Object.keys(groups).length < 2 || pooled >= total) return null;
  return (
    <Callout tone="info">
      {`Pooled the ${pooled} of ${total} runs in this period that share one measurement setup. The other ${total - pooled} used a different set of models or prompts, so their answers are not comparable with these and are not counted here — open them individually from the measurement menu.`}
    </Callout>
  );
}

/** The answers behind the tiles and what their change line compares against. */
function CoverageStrip({ selected }: Readonly<{ selected: Visibility }>) {
  const timeZone = useDisplayTimeZone();
  const summary = coverageSummary(selected, (iso) => formatDisplayDate(iso, timeZone));
  return (
    <p className={textRole('caption')}>
      {summary.answers} {summary.change}
    </p>
  );
}

function HeadlineMetrics({ selected }: Readonly<{ selected: Visibility }>) {
  const brand = selected.rankings.find((row) => row.is_brand);
  const count = selected.counts;
  const comparison = selected.comparison;
  const unmeasured = observationLabel(count?.state);
  const definitions = [
    {
      key: 'visibility',
      label: 'Visibility',
      value: selected.visibility_rate ?? null,
      explanation: 'The share of answers that name your brand.',
    },
    {
      key: 'sov',
      label: 'Share of voice',
      value: brand?.share_of_voice ?? null,
      explanation:
        'Your share of every brand mention across the brands you track. Repeated mentions in one answer count once.',
    },
    {
      key: 'owned_citation',
      label: 'Owned citation rate',
      value: selected.owned_citation_rate ?? null,
      explanation: 'The share of answers that link to a page you own.',
    },
  ];
  // Position is a rank, not a rate, so it renders beside the rates rather than
  // through `formatRate`, and as a whole place rather than the mean's fraction.
  // Runs measured before competitor offsets were persisted have none, and the
  // tile is omitted rather than shown empty.
  const position = brand?.avg_position ?? selected.avg_position ?? null;
  const segments: StatSegment[] = definitions.map((item) => {
    const change = comparison?.deltas[item.key];
    return {
      key: item.key,
      label: item.label,
      marker: <InfoHint label={item.label}>{item.explanation}</InfoHint>,
      value: unmeasured ?? formatRate(item.value),
      // No comparable run means no change line at all. The coverage strip
      // below states the reason once, not a placeholder repeated three times.
      delta: change == null ? null : <Delta value={change} unit=" pp" />,
    };
  });
  if (position != null) {
    segments.push({
      key: 'avg_position',
      // Not "Rank": the table's Rank (and the Overview's) orders the tracked
      // brands by visibility; this is the mean place an answer names you in.
      label: AVERAGE_POSITION,
      marker: (
        <InfoHint label={AVERAGE_POSITION}>
          {`Where your brand tends to appear among the brands you TRACK — you and your configured competitors — within the answers that name you, averaged to ${formatPositionExact(position)}. A brand an answer names that you do not track is not counted. This is a different measure from Rank, which orders the tracked brands by visibility, so the two can differ.`}
        </InfoHint>
      ),
      value: formatPosition(position),
    });
  }
  return <KpiRow segments={segments} />;
}

function MeasurementHistory({
  query,
  metric,
  setMetric,
  focused,
  onClearFocus,
  brandName,
}: Readonly<{
  query: UseQueryResult<VisibilityTrendPoint[], unknown>;
  metric: (typeof VISIBILITY_METRICS)[number]['value'];
  setMetric: (value: (typeof VISIBILITY_METRICS)[number]['value']) => void;
  /** Plot this brand alone, or the default roster when null. */
  focused: string | null;
  onClearFocus: () => void;
  brandName: string | null;
}>) {
  const timeZone = useDisplayTimeZone();
  const metricLabel =
    VISIBILITY_METRICS.find((item) => item.value === metric)?.label ?? 'Visibility';
  return (
    <Card>
      <CardHeader
        actions={
          <>
            {/* Beside the metric picker, not inside the key: a control in
                the key's row made the key one height focused and another
                with the roster (2026-11-03 app review). */}
            {focused ? (
              <Button variant="secondary" onClick={onClearFocus}>
                Show all brands
              </Button>
            ) : null}
            <FilterChoice
              label="Plotted metric"
              value={metric}
              options={VISIBILITY_METRICS}
              onChange={setMetric}
            />
          </>
        }
      >
        <CardTitle>Over time</CardTitle>
      </CardHeader>
      <CardContent>
        <MeasurementHistoryBody
          query={query}
          metric={metric}
          metricLabel={metricLabel}
          focused={focused}
          brandName={brandName}
          timeZone={timeZone}
        />
      </CardContent>
    </Card>
  );
}

type HistoryChartProps = Readonly<{
  points: readonly VisibilityTrendPoint[];
  metric: (typeof VISIBILITY_METRICS)[number]['value'];
  metricLabel: string;
  focused: string | null;
  brandName: string | null;
  timeZone: string;
  busy: boolean;
}>;

/** The history card's content: the failed read, or the line chart. */
function MeasurementHistoryBody({
  query,
  ...chart
}: Omit<HistoryChartProps, 'points' | 'busy'> &
  Readonly<{ query: UseQueryResult<VisibilityTrendPoint[], unknown> }>) {
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load history."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  return <HistoryLineChart points={query.data ?? []} busy={query.isFetching} {...chart} />;
}

function HistoryLineChart({
  points,
  metric,
  metricLabel,
  focused,
  brandName,
  timeZone,
  busy,
}: HistoryChartProps) {
  // Focusing the tracked brand is the brand's OWN series, not a ranking lookup:
  // the rankings carry competitors and the brand alike, but the brand's line is
  // the one the projection publishes directly.
  const focusedIsBrand = focused !== null && focused === brandName;
  const base =
    focused === null || focusedIsBrand
      ? toChartPoints(points, metric, timeZone)
      : toNamedChartPoints(points, metric, focused, timeZone);
  const chartPoints = base.map((point) => ({
    ...point,
    // The plotted values are already whole percent, so `formatRate` — which
    // scales a 0–1 rate — turned 38% into "3800%" in every hover label.
    label: `${point.dateLabel} · ${formatWholePercent(point.value)}`,
    // The full date is the hover; the axis tick gets the short form the
    // series was built with, so the ticks stay readable at three across.
    axisLabel: point.label,
  }));
  // One selected brand means one line: the comparison roster is what the reader
  // asked to step out of.
  const competitors = focused === null ? toCompetitorSeries(points, metric) : [];
  const primaryLabel = focused ?? 'You';
  return (
    <Stack gap="compact" aria-busy={busy}>
      <TrendChart
        label={`${metricLabel} over time`}
        name={primaryLabel}
        data={chartPoints}
        series={competitors}
        yMax={100}
        yFormat={(value) => `${Math.round(value)}%`}
        compact
        directLabels
      />
    </Stack>
  );
}
