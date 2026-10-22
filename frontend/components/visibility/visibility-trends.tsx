'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FilterChoice } from '@/components/ui/filter-bar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { httpErrorStatus } from '@/lib/api/errors';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LegendSwatch } from '@/components/ui/chart';
import type { DataTone } from '@/components/ui/data-tone';
import { Delta } from '@/components/ui/delta';
import { Stack } from '@/components/ui/layout';
import { InfoHint } from '@/components/ui/info-hint';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { TrendChart } from '@/components/ui/trend-chart';
import { textRole } from '@/components/ui/typography';
import { MetricGroup, MetricItem, splitPaneClasses } from '@/components/ui/workspace';
import { RankingRowsTable } from '@/components/visibility/ranking-rows';
import { EngineComparison } from '@/components/visibility/engine-comparison';
import { SurfaceRatesPanel } from '@/components/visibility/surface-rates';
import type { SurfaceRates, Visibility, VisibilityTrendPoint } from '@/lib/api/types';
import {
  formatPosition,
  formatPositionExact,
  formatRate,
  formatWholePercent,
  type VisibilityFilters,
} from '@/lib/visibility/dashboard';
import {
  formatPointDate,
  toChartPoints,
  toCompetitorSeries,
  toNamedChartPoints,
} from '@/lib/visibility/trends';
import { observationLabel } from '@/lib/visibility/vocabulary';
import { coverageSummary } from '@/lib/visibility/coverage';
import { formatDisplayDate } from '@/lib/format';
import { VISIBILITY_METRICS } from '@/lib/config/visibility';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

const metricCodec = stringUrlCodec(
  VISIBILITY_METRICS.map((item) => item.value),
  'brand_mention_rate',
);

export function VisibilityTrends({
  query,
  visibilityQuery,
  engineFilter,
  surfaceRatesQuery,
  surfaceEngine,
  onEvidence,
}: Readonly<{
  query: UseQueryResult<VisibilityTrendPoint[], unknown>;
  visibilityQuery: UseQueryResult<Visibility, unknown>;
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
  const selected = visibilityQuery.data;
  if (visibilityQuery.isError) {
    // A 404 here is not a failure: the run exists but its results have not been
    // written yet, which is the normal state for the seconds after a run ends.
    // Reporting that as an error told readers their results were lost.
    if (httpErrorStatus(visibilityQuery.error) === 404)
      return (
        <Alert tone="info">
          Results for this run are still being prepared. They appear here as soon as they are ready.
        </Alert>
      );
    return (
      <QueryState
        kind="error"
        error={visibilityQuery.error}
        fallback="Could not load the selected measurement."
        onRetry={() => void visibilityQuery.refetch()}
        pending={visibilityQuery.isFetching}
      />
    );
  }
  if (!selected) return <QueryState kind="loading" label="Loading selected measurement…" />;
  // A `brand` carried in from another run's URL may name nobody in THIS
  // selection. Plotting it anyway drew an empty chart captioned with a brand
  // the run never measured, which reads as "measured, scored zero". An
  // unrecognized name falls back to the full roster.
  const focusedBrand =
    focused !== null && selected.rankings.some((row) => row.name === focused) ? focused : null;
  return (
    <Stack gap="workspace" aria-busy={visibilityQuery.isFetching}>
      <PooledSelectionNote selected={selected} />
      <HeadlineMetrics selected={selected} />
      <CoverageStrip selected={selected} />
      {/* Only when the reader has narrowed to the observed surface. These
          rates divide by observations, not by answers, so showing them beside
          an unfiltered cross-surface view would invite reading them as the
          whole product's numbers. */}
      {surfaceEngine ? <SurfaceRatesPanel query={surfaceRatesQuery} /> : null}
      <div className={splitPaneClasses('peers')}>
        <MeasurementHistory
          query={query}
          metric={metric}
          setMetric={setMetric}
          focused={focusedBrand}
          onClearFocus={() => setFocused(null)}
          brandName={selected.rankings.find((row) => row.is_brand)?.name ?? null}
        />
        <Card>
          <CardHeader>
            <CardTitle>Brand and competitors</CardTitle>
            <CardDescription>
              How often each brand is named, across the same answers. Select a row to plot it on its
              own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankingRowsTable
              rows={selected.rankings}
              onSelect={setFocused}
              selectedName={focusedBrand}
            />
          </CardContent>
        </Card>
      </div>
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
    <Alert tone="info">
      {`Pooled the ${pooled} of ${total} runs in this period that share one measurement setup. The other ${total - pooled} used a different set of models or prompts, so their answers are not comparable with these and are not counted here — open them individually from the measurement menu.`}
    </Alert>
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
  return (
    <MetricGroup>
      {definitions.map((item) => {
        const change = comparison?.deltas[item.key];
        return (
          <MetricItem
            key={item.key}
            label={
              <span className="inline-flex items-center gap-2">
                {item.label}
                <InfoHint label={item.label}>{item.explanation}</InfoHint>
              </span>
            }
            value={unmeasured ?? formatRate(item.value)}
            // No comparable run means no change line at all. The coverage strip
            // below states the reason once, not a placeholder repeated three times.
            detail={change == null ? null : <Delta value={change} unit=" pp" />}
          />
        );
      })}
      {position == null ? null : (
        <MetricItem
          label={
            <span className="inline-flex items-center gap-2">
              Average position
              <InfoHint label="Average position">
                {`Where your brand tends to appear among the brands you TRACK — you and your configured competitors. A brand an answer names that you do not track is not counted, so this is not a rank within the whole answer. Counted only over the answers that named you, and averaged to ${formatPositionExact(position)}.`}
              </InfoHint>
            </span>
          }
          value={formatPosition(position)}
        />
      )}
    </MetricGroup>
  );
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
  const points = query.data ?? [];
  const metricLabel =
    VISIBILITY_METRICS.find((item) => item.value === metric)?.label ?? 'Visibility';
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
    label: `${formatPointDate(point.completedAt, timeZone)} · ${formatWholePercent(point.value)}`,
    // The full date is the hover; the axis tick gets the short form the
    // series was built with, so the ticks stay readable at three across.
    axisLabel: point.label,
  }));
  // One selected brand means one line: the comparison roster is what the reader
  // asked to step out of.
  const competitors = focused === null ? toCompetitorSeries(points, metric) : [];
  const primaryLabel = focused ?? 'You';

  let body: ReactNode;
  if (query.isError) {
    body = (
      <ReadError
        error={query.error}
        fallback="Could not load history."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  } else if (query.isPending) {
    body = (
      <output className="bg-surface-2 grid min-h-48 place-items-center rounded-[var(--radius-control)]">
        <span className={textRole('body', 'text-secondary')}>Loading measurement history…</span>
      </output>
    );
  } else if (!points.length) {
    body = <InlineEmpty>No measurements in this period yet.</InlineEmpty>;
  } else {
    body = (
      <Stack gap="compact" aria-busy={query.isFetching}>
        <TrendChart
          label={`${metricLabel} over time`}
          data={chartPoints}
          series={competitors}
          width={360}
          height={168}
          xAxisLabel="Run date"
          yAxisLabel={`${metricLabel} (%)`}
          formatTick={(value) => `${Math.round(value)}%`}
          className="h-auto w-full"
        />
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <SeriesKey label={primaryLabel} tone={{ series: 1 }} />
          {competitors.map((entry) => (
            <SeriesKey key={entry.label} label={entry.label} tone={{ series: entry.series }} />
          ))}
          {focused ? (
            <li>
              <Button variant="ghost" onClick={onClearFocus}>
                Show all brands
              </Button>
            </li>
          ) : null}
        </ul>
      </Stack>
    );
  }
  return (
    <Card>
      <CardHeader
        actions={
          <FilterChoice
            label="Plotted metric"
            value={metric}
            options={VISIBILITY_METRICS}
            onChange={setMetric}
          />
        }
      >
        <CardTitle>Over time</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

/** One entry in the chart key: the brand, then each comparison line. */
function SeriesKey({ label, tone }: Readonly<{ label: string; tone: DataTone }>) {
  return (
    <li className="flex items-center gap-2">
      <LegendSwatch tone={tone} />
      <span className={textRole('caption')}>{label}</span>
    </li>
  );
}
