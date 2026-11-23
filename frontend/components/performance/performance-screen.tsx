import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { DateRangeDialog } from './date-range-dialog';
import {
  granularityFilter,
  PerformanceActions,
  PerformanceNotice,
  PerformanceToolbar,
  PerformanceWindowCaption,
  performanceNotices,
  ProjectionFailure,
} from './performance-chrome';
import { Ga4SummaryRow, MetricCards, MetricDefinitions } from './metric-cards';
import { PerformanceBreakdowns } from './performance-breakdowns';
import { METRIC_MARKS, PerformanceChart, type ChartSeries } from './performance-chart';
import { ReadinessLadder, useProjectReadiness } from './readiness-ladder';
import { DataSourceSetup } from '@/components/integrations/data-source-setup';
import { usePerformanceSelection } from './use-performance-selection';
import { usePerformanceSync } from './use-performance-sync';
import { useRangeProjection } from './use-range-projection';
import { RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { ReportPage } from '@/components/templates/report-page';
import { Stack } from '@/components/ui/layout';
import { Section, SectionDescription, SectionHeader, SectionTitle } from '@/components/ui/section';
import { FilterBar, type FilterBarProps } from '@/components/ui/filter-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { formatWindowDate, pluralCount } from '@/lib/format';
import { ChartNoAxesColumn } from '@/lib/icons';
import { integrationsQueries } from '@/lib/api/integrations';
import {
  performanceQueries,
  type PerformanceDashboard,
  type PerformanceGranularity,
  type ProjectReadiness,
} from '@/lib/api/performance';
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
import { readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

function chartSeries(
  selected: PerformanceDashboard['selected'],
  comparison: PerformanceDashboard['comparison'],
  active: ReadonlySet<PerformanceMetricKey>,
): ChartSeries[] {
  return METRIC_CARDS.filter((card) => active.has(card.key)).map((card) => ({
    key: card.key,
    label: card.label,
    mark: METRIC_MARKS[card.key],
    selected: toChartPoints(selected.series[card.key]),
    comparison: comparison ? toChartPoints(comparison.series[card.key]) : null,
  }));
}

function compareLabel(selection: RangeSelection): string {
  return (
    COMPARE_OPTIONS.find((option) => option.value === selection.compare)?.label ?? 'Comparison'
  );
}

function evidenceAvailability(data: PerformanceDashboard, readiness: ProjectReadiness | undefined) {
  const { totals, snapshot_id: snapshotId } = data.selected;
  const bingConnected = readiness?.providers.includes('bing') ?? false;
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
    (bingConnected || data.dimension_counts.bing_query > 0 || data.dimension_counts.bing_page > 0);
  return {
    hasSearchConsoleTotals,
    hasSearchConsoleBreakdowns,
    hasGa4,
    hasBing,
  };
}

function performanceCoverage(
  data: PerformanceDashboard,
  evidence: ReturnType<typeof evidenceAvailability>,
) {
  const hasEvidence = evidence.hasSearchConsoleBreakdowns || evidence.hasGa4 || evidence.hasBing;
  const firstUse =
    !hasEvidence && data.coverage.covered_days === 0 && data.selected.snapshot_id === null;
  return {
    hasEvidence,
    firstUse,
    selectedMissing: !firstUse && data.selected.snapshot_id === null,
    comparisonMissing:
      !firstUse && data.comparison !== null && data.comparison.snapshot_id === null,
  };
}

function coverageSummary(coverage: PerformanceDashboard['coverage']): string | null {
  if (!coverage.earliest_date || !coverage.latest_date) return null;
  return `${formatWindowDate(coverage.earliest_date)} – ${formatWindowDate(
    coverage.latest_date,
  )} · ${pluralCount(coverage.covered_days, 'day')}`;
}

function FirstUseEmptyState({ action }: Readonly<{ action: ReactNode }>) {
  return (
    <Section>
      <StateBlock
        kind="empty"
        icon={ChartNoAxesColumn}
        heading="No Search Console history yet"
        action={action}
      />
    </Section>
  );
}

function PerformanceEmptyState({
  data,
  projecting,
  failed,
}: Readonly<{ data: PerformanceDashboard; projecting: boolean; failed: boolean }>) {
  if (failed) return null;
  if (projecting) {
    return (
      <Section>
        <StateBlock
          kind="empty"
          icon={ChartNoAxesColumn}
          heading="Building this performance range"
        />
      </Section>
    );
  }
  if (data.coverage.covered_days === 0 && data.selected.snapshot_id === null) return null;
  return (
    <Section>
      <StateBlock kind="empty" icon={ChartNoAxesColumn} heading="No performance evidence here" />
    </Section>
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
  coverage,
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
  coverage: string | null;
}>) {
  if (!available) return null;
  return (
    <Section aria-labelledby="performance-search-console">
      <SectionHeader actions={<MetricDefinitions />}>
        <SectionTitle id="performance-search-console">Google Search</SectionTitle>
        {coverage ? (
          <SectionDescription data-testid="performance-coverage">{coverage}</SectionDescription>
        ) : null}
      </SectionHeader>
      <Stack gap="workspace" className="min-w-0">
        <MetricCards
          data-testid="metric-card-strip"
          className="min-w-0"
          selected={selected}
          comparison={comparison}
          compareLabel={compareLabel}
          selectedLabel={selectedLabel}
          active={activeMetrics}
          onToggle={onToggleMetric}
          marks={METRIC_MARKS}
          loading={refreshing}
        />
        <Section aria-label="Search Console chart">
          <PerformanceChart series={series} />
        </Section>
      </Stack>
    </Section>
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
    <Section aria-labelledby="performance-ga4">
      <SectionHeader>
        <SectionTitle id="performance-ga4">Google Analytics 4</SectionTitle>
      </SectionHeader>
      <Ga4SummaryRow
        selected={selected}
        comparison={comparison}
        compareLabel={compareLabel}
        loading={refreshing}
      />
    </Section>
  );
}

function performanceControls({
  selection,
  onSelectRange,
  onOpenDialog,
  onReset,
  hasChart,
  granularity,
  onGranularityChange,
  windowLabel,
  latestDate,
}: Readonly<{
  selection: RangeSelection;
  onSelectRange: (selection: RangeSelection) => void;
  onOpenDialog: (tab: 'filter' | 'compare') => void;
  onReset: () => void;
  hasChart: boolean;
  granularity: PerformanceGranularity;
  onGranularityChange: (next: PerformanceGranularity) => void;
  windowLabel: string;
  latestDate: string | null;
}>): FilterBarProps {
  return {
    view: (
      <PerformanceToolbar
        selection={selection}
        onOpenRange={() => onOpenDialog('filter')}
        onOpenCompare={() => onOpenDialog('compare')}
        onSelectRange={onSelectRange}
        comparing={selection.compare !== 'none'}
        onReset={onReset}
      />
    ),
    filters: hasChart ? [granularityFilter(granularity, onGranularityChange)] : undefined,
    status: <PerformanceWindowCaption label={windowLabel} latestDate={latestDate} />,
  };
}

function PerformanceLoading() {
  return (
    <ReportPage filters={<FilterBar {...RESERVED_CONTROLS} />}>
      <Section aria-labelledby="performance-search-console-loading">
        <SectionHeader>
          <SectionTitle id="performance-search-console-loading">Google Search</SectionTitle>
        </SectionHeader>
        <Stack gap="workspace">
          <Skeleton variant="stat" count={4} label="Loading performance" />
          <Skeleton variant="chart" height="md" />
        </Stack>
      </Section>
    </ReportPage>
  );
}

function answeredNoConnections(
  read: Readonly<{ isSuccess: boolean; data: readonly unknown[] | undefined }>,
): boolean {
  return read.isSuccess && read.data?.length === 0;
}

function idleSync(sync: ReturnType<typeof usePerformanceSync>) {
  return sync.syncing || sync.mutation.isPending ? undefined : sync.start;
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

  if (dashboard.isError)
    return (
      <ReportPage>
        <StateBlock
          kind="error"
          {...readErrorProps(dashboard)}
          fallback="Couldn't load performance data. The request failed or timed out."
          title="Couldn't load performance data"
        />
      </ReportPage>
    );
  if (!dashboard.data) return <PerformanceLoading />;

  const data = dashboard.data;
  const refreshing = dashboard.isPlaceholderData || projection.projecting;
  const selectedWindow = data.selected;
  const comparisonWindow = data.comparison;
  const selectedLabel = describeWindow(selectedWindow);
  const comparisonLabel = compareLabel(selection);
  const series = chartSeries(selectedWindow, comparisonWindow, activeMetrics);
  const evidence = evidenceAvailability(data, readiness.data);
  const coverage = performanceCoverage(data, evidence);
  const syncAction = (
    <PerformanceActions noConnections={answeredNoConnections(connections)} sync={sync} />
  );

  return (
    <ReportPage
      actions={coverage.firstUse ? undefined : syncAction}
      filters={
        coverage.firstUse ? undefined : (
          <FilterBar
            {...performanceControls({
              selection,
              onSelectRange: setSelection,
              onOpenDialog: (tab) => {
                setDialogTab(tab);
                setDialogOpen(true);
              },
              onReset: resetFilters,
              hasChart: evidence.hasSearchConsoleTotals,
              granularity,
              onGranularityChange: setGranularity,
              windowLabel: selectedLabel,
              latestDate: data.coverage.latest_date,
            })}
          />
        )
      }
    >
      <Stack gap="workspace">
        <DataSourceSetup
          required={['gsc']}
          optional={['ga4', 'bing']}
          title="Connect Search Console"
          unconnected={{
            heading: 'Connect Google and Bing',
          }}
          whenReady={coverage.firstUse ? <FirstUseEmptyState action={syncAction} /> : null}
        />
        {readiness.isError ? null : <ReadinessLadder data={readiness.data} sync={idleSync(sync)} />}

        <PerformanceNotice
          messages={performanceNotices({
            sync,
            projecting: projection.projecting,
            projectionFailed: projection.failure !== null,
            selectedMissing: coverage.selectedMissing,
            comparisonMissing: coverage.comparisonMissing,
            readinessFailed: readiness.isError,
          })}
        />

        <ProjectionFailure failure={projection.failure} />
        {!coverage.hasEvidence ? (
          <PerformanceEmptyState
            data={data}
            projecting={projection.projecting}
            failed={projection.failure !== null}
          />
        ) : (
          <>
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
              coverage={coverageSummary(data.coverage)}
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
    </ReportPage>
  );
}
