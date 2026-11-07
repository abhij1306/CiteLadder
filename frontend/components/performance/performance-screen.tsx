'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { DateRangeDialog } from './date-range-dialog';
import {
  GranularitySelect,
  PerformanceActions,
  PerformanceToolbar,
  performanceNotices,
} from './performance-chrome';
import { Ga4SummaryRow, MetricCards } from './metric-cards';
import { PerformanceBreakdowns } from './performance-breakdowns';
import { PerformanceChart, type ChartSeries } from './performance-chart';
import { ReadinessLadder, useProjectReadiness } from './readiness-ladder';
import { DataSourceSetup } from '@/components/integrations/data-source-setup';
import { usePerformanceSelection } from './use-performance-selection';
import { usePerformanceSync } from './use-performance-sync';
import { useRangeProjection } from './use-range-projection';
import { ListScreen, RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { Stack } from '@/components/ui/layout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ChartTone } from '@/components/ui/chart';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { StatusLine } from '@/components/ui/status-line';
import { formatCount, formatWindowDate } from '@/lib/format';
import { ChartNoAxesColumn } from 'lucide-react';
import { integrationsQueries } from '@/lib/api/integrations';
import { performanceQueries, type PerformanceDashboard } from '@/lib/api/performance';
import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { useProjectScope } from '@/lib/project/active-project-scope';
import {
  COMPARE_OPTIONS,
  METRIC_CARDS,
  canCompareYearOverYear,
  dashboardParams,
  describeWindow,
  toChartPoints,
  windowLength,
  type PerformanceMetricKey,
  type RangeSelection,
} from '@/lib/performance/performance';

/**
 * The Performance surface: one resolved range, its optional comparison, four
 * selectable GSC metrics on one chart, a compact GA4 row, and six keyset
 * tables — all reading the SAME persisted snapshot the dashboard resolved.
 *
 * Nothing here computes a window: presets resolve server-side against the
 * latest complete GSC date, and a custom or comparison window with no
 * projection is materialized by the range task rather than derived in the
 * browser. What the screen displays is always the window actually covered.
 */

// Each metric's chart position (its colour and texture), shared by the card
// keys and the chart lines: `data-1` to `data-3`, then Position in `data-other`.
const METRIC_TONES: Record<PerformanceMetricKey, ChartTone> = {
  clicks: 1,
  impressions: 2,
  ctr: 3,
  position: 4,
};

/** The drawn lines: one per selected metric, each with its comparison peer. */
function chartSeries(
  selected: PerformanceDashboard['selected'],
  comparison: PerformanceDashboard['comparison'],
  active: ReadonlySet<PerformanceMetricKey>,
): ChartSeries[] {
  return METRIC_CARDS.filter((card) => active.has(card.key)).map((card) => ({
    key: card.key,
    label: card.label,
    tone: METRIC_TONES[card.key],
    selected: toChartPoints(selected.series[card.key]),
    comparison: comparison ? toChartPoints(comparison.series[card.key]) : null,
  }));
}

function compareLabel(selection: RangeSelection): string {
  return (
    COMPARE_OPTIONS.find((option) => option.value === selection.compare)?.label ?? 'Comparison'
  );
}

function evidenceAvailability(data: PerformanceDashboard) {
  const { totals, snapshot_id: snapshotId } = data.selected;
  const hasSearchConsoleTotals = totals.clicks !== null || totals.impressions !== null;
  const hasSearchConsoleDimensions = [
    data.dimension_counts.query,
    data.dimension_counts.page,
    data.dimension_counts.country,
    data.dimension_counts.device,
    data.dimension_counts.search_appearance,
    data.dimension_counts.day,
  ].some((count) => count > 0);
  const hasSearchConsoleBreakdowns = hasSearchConsoleTotals || hasSearchConsoleDimensions;
  const hasGa4 = totals.sessions !== null || totals.key_events !== null;
  const hasBing =
    snapshotId !== null &&
    (data.dimension_counts.bing_query > 0 || data.dimension_counts.bing_page > 0);
  return {
    hasSearchConsoleTotals,
    hasSearchConsoleBreakdowns,
    hasGa4,
    hasBing,
  };
}

function performanceCoverage(data: PerformanceDashboard, hasEvidence: boolean) {
  const firstUse =
    !hasEvidence && data.coverage.covered_days === 0 && data.selected.snapshot_id === null;
  return {
    firstUse,
    selectedMissing: !firstUse && data.selected.snapshot_id === null,
    comparisonMissing:
      !firstUse && data.comparison !== null && data.comparison.snapshot_id === null,
  };
}

function hasQualityFlags(quality: PerformanceDashboard['coverage']['analytics_quality']) {
  return Object.values(quality).some((days) => days.some((day) => day.flags.length > 0));
}

/** The status line at rest: the history the dashboard can draw from. */
function coverageSummary(coverage: PerformanceDashboard['coverage']): string {
  // The extent spans the imported metric rows, so no dates means no rows —
  // which is not the same as no import having run.
  if (!coverage.earliest_date || !coverage.latest_date) return 'No imported search rows yet.';
  return `Imported history ${formatWindowDate(coverage.earliest_date)} – ${formatWindowDate(
    coverage.latest_date,
  )} · ${formatCount(coverage.covered_days)} days`;
}

function PerformanceEmptyState({
  data,
  projecting,
}: Readonly<{ data: PerformanceDashboard; projecting: boolean }>) {
  if (projecting) {
    return (
      <QueryState
        kind="empty"
        icon={ChartNoAxesColumn}
        heading="Building this performance range"
        description="CiteLadder is preparing this view from the traffic evidence already imported."
      />
    );
  }
  const firstUse = data.coverage.covered_days === 0 && data.selected.snapshot_id === null;
  return (
    <QueryState
      kind="empty"
      icon={ChartNoAxesColumn}
      heading={firstUse ? 'No search performance evidence yet' : 'No performance evidence here'}
      description={
        firstUse
          ? 'Your numbers appear here as soon as the first import lands.'
          : 'Choose a range inside the imported history, or sync the missing dates.'
      }
    />
  );
}

function SearchConsoleWorkspace({
  available,
  selected,
  comparison,
  selectedLabel,
  compareLabel,
  activeMetrics,
  onToggleMetric,
  series,
  refreshing,
}: Readonly<{
  available: boolean;
  selected: PerformanceDashboard['selected'];
  comparison: PerformanceDashboard['comparison'];
  selectedLabel: string;
  compareLabel: string;
  activeMetrics: ReadonlySet<PerformanceMetricKey>;
  onToggleMetric: (metric: PerformanceMetricKey) => void;
  series: ChartSeries[];
  refreshing: boolean;
}>) {
  if (!available) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <MetricCards
          data-testid="metric-card-strip"
          className="min-w-0"
          selected={selected}
          comparison={comparison}
          compareLabel={compareLabel}
          selectedLabel={selectedLabel}
          active={activeMetrics}
          onToggle={onToggleMetric}
          tones={METRIC_TONES}
          loading={refreshing}
        />
      </CardHeader>
      <CardContent>
        <PerformanceChart series={series} />
      </CardContent>
    </Card>
  );
}

function Ga4Workspace({
  available,
  selected,
  comparison,
  compareLabel,
  refreshing,
}: Readonly<{
  available: boolean;
  selected: PerformanceDashboard['selected'];
  comparison: PerformanceDashboard['comparison'];
  compareLabel: string;
  refreshing: boolean;
}>) {
  if (!available) return null;
  return (
    <Ga4SummaryRow
      selected={selected}
      comparison={comparison}
      compareLabel={compareLabel}
      loading={refreshing}
    />
  );
}

/**
 * The first load holds the control band the loaded page draws its range
 * toolbar in, so the work starts on the same line before and after.
 */
function PerformanceLoading() {
  return (
    <ListScreen controls={RESERVED_CONTROLS}>
      <QueryState kind="loading" label="Loading performance…" />
    </ListScreen>
  );
}

/**
 * The chart's bucket size is a control of what is shown, so it rides the one
 * control band, not the KPI card's header (2026-11-03 review), at its end so
 * it does not read as part of the range. Absent while there is no chart.
 */
function granularityAction(
  shown: boolean,
  value: PerformanceDashboard['granularity'],
  onChange: (value: PerformanceDashboard['granularity']) => void,
) {
  return shown ? <GranularitySelect value={value} onChange={onChange} /> : undefined;
}

export function PerformanceScreen() {
  const { projectId, workspaceId } = useProjectScope();
  const scope = { workspaceId, projectId };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<'filter' | 'compare'>('filter');
  const {
    selection,
    setSelection,
    granularity,
    setGranularity,
    dimension,
    setDimension,
    activeMetrics,
    toggleMetric,
    reset: resetFilters,
  } = usePerformanceSelection();

  const dashboard = useQuery({
    ...performanceQueries.dashboard(scope, dashboardParams(selection, granularity)),
    placeholderData: (previousData, previousQuery) =>
      retainPreviousDataForScope(projectId, previousData, previousQuery),
  });
  const connections = useQuery(integrationsQueries.connections(workspaceId));
  const sync = usePerformanceSync();
  const readiness = useProjectReadiness();
  const projection = useRangeProjection(scope, dashboard.data);

  // Every state keeps its identity band: a page that loses its heading and its
  // rule while loading is a different-looking page, and the work below it moves
  // when the real one arrives.
  if (dashboard.isError)
    return (
      <ListScreen>
        <QueryState
          kind="error"
          {...readErrorProps(dashboard)}
          fallback="Could not load performance data. Check your connection and try again."
        />
      </ListScreen>
    );
  // Only the dashboard controls the screen's first paint. Connections feeds
  // one toolbar button and readiness one advisory ladder — both render into
  // an already-drawn page, so a slow secondary read must not hold the whole
  // surface on the slowest of three independent requests. Retained previous
  // scope data (a placeholder) counts as paintable.
  if (!dashboard.data) return <PerformanceLoading />;

  const data = dashboard.data as PerformanceDashboard;
  // The figures on screen belong to a DIFFERENT selection (retained while the
  // new one loads), or the window's projection is still being built. The value
  // slots spin instead of claiming a figure is absent — and they keep their
  // boxes, so nothing below them moves.
  //
  // Not `isFetching`: a background revalidation of the same selection keeps
  // figures that are still current, and swapping them for spinners only to
  // put the identical numbers back was the return-to-Performance flicker.
  const refreshing = dashboard.isPlaceholderData || projection.projecting;
  const selectedWindow = data.selected;
  const comparisonWindow = data.comparison;
  const selectedLabel = describeWindow(selectedWindow);
  const comparisonLabel = compareLabel(selection);
  const series = chartSeries(selectedWindow, comparisonWindow, activeMetrics);
  const evidence = evidenceAvailability(data);
  const hasEvidence = evidence.hasSearchConsoleBreakdowns || evidence.hasGa4 || evidence.hasBing;
  const coverage = performanceCoverage(data, hasEvidence);

  return (
    <ListScreen
      actions={
        <PerformanceActions
          latestDate={data.coverage.latest_date}
          hasConnections={Boolean(connections.data?.length)}
          sync={sync}
        />
      }
      controls={{
        actions: granularityAction(evidence.hasSearchConsoleTotals, granularity, setGranularity),
        filters: (
          <PerformanceToolbar
            selection={selection}
            selectedLabel={selectedLabel}
            onOpenRange={() => {
              setDialogTab('filter');
              setDialogOpen(true);
            }}
            onOpenCompare={() => {
              setDialogTab('compare');
              setDialogOpen(true);
            }}
            onSelectRange={setSelection}
            comparing={selection.compare !== 'none'}
            onReset={resetFilters}
          />
        ),
      }}
    >
      <Stack gap="workspace">
        <DataSourceSetup
          required={['gsc']}
          optional={['ga4', 'bing']}
          title="Connect Search Console"
          description="Performance reads this project's own search data. Connect Google and use the property for this site; Analytics and Bing are optional."
        />
        {readiness.isError ? null : (
          <ReadinessLadder
            data={readiness.data}
            sync={sync.syncing || sync.mutation.isPending ? undefined : sync.start}
          />
        )}

        <StatusLine
          testId="performance-status"
          resting={coverageSummary(data.coverage)}
          messages={performanceNotices({
            sync,
            projecting: projection.projecting,
            selectedMissing: coverage.selectedMissing,
            comparisonMissing: coverage.comparisonMissing,
            qualityFlagged: hasQualityFlags(data.coverage.analytics_quality),
            readinessFailed: readiness.isError,
          })}
        />

        {!hasEvidence ? (
          <PerformanceEmptyState data={data} projecting={projection.projecting} />
        ) : (
          <>
            {/* One card holds the strip and the plot it drives: selecting a card
          changes the lines directly beneath it, so a gap between them would
          split a control from its own result. The strip sits flush with the
          granularity control aligned on the right of the header row. */}
            <SearchConsoleWorkspace
              available={evidence.hasSearchConsoleTotals}
              selected={selectedWindow}
              comparison={comparisonWindow}
              selectedLabel={selectedLabel}
              compareLabel={comparisonLabel}
              activeMetrics={activeMetrics}
              onToggleMetric={toggleMetric}
              series={series}
              refreshing={refreshing}
            />
            <Ga4Workspace
              available={evidence.hasGa4}
              selected={selectedWindow}
              comparison={comparisonWindow}
              compareLabel={comparisonLabel}
              refreshing={refreshing}
            />

            <PerformanceBreakdowns
              projectId={projectId}
              dimension={dimension}
              onDimensionChange={setDimension}
              snapshotId={selectedWindow.snapshot_id}
              compareSnapshotId={comparisonWindow?.snapshot_id ?? null}
              dimensionCounts={data.dimension_counts}
              unavailableDimensions={data.unavailable_dimensions}
              activeMetrics={activeMetrics}
              selectedLabel={selectedLabel}
              compareLabel={comparisonLabel}
              hasSearchConsole={evidence.hasSearchConsoleBreakdowns}
              // Only when a Bing connection exists: Bing's panel states "measured
              // nothing", which is not what an absent connection means.
              hasBing={evidence.hasBing}
            />
          </>
        )}
        <DateRangeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialTab={dialogTab}
          selection={selection}
          onApply={setSelection}
          coverage={{
            earliest: data.coverage.earliest_date,
            latest: data.coverage.latest_date,
          }}
          yearOverYearAvailable={canCompareYearOverYear(
            data.coverage.covered_days,
            windowLength(selectedWindow) || 1,
          )}
        />
      </Stack>
    </ListScreen>
  );
}
