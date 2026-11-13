import type { ReactNode } from 'react';

import { ActiveRunBanner } from '@/components/visibility/active-run-banner';
import { VisibilityEmptyState } from '@/components/visibility/empty-state';
import { FanoutEvidence } from '@/components/visibility/fanout-evidence';
import { VisibilitySources } from '@/components/visibility/visibility-sources';
import { VisibilityPerception } from '@/components/visibility/visibility-perception';
import { VisibilityAccuracy } from '@/components/visibility/visibility-accuracy';
import { VisibilityAds } from '@/components/visibility/visibility-ads';
import { VisibilityByMarket } from '@/components/visibility/visibility-by-market';
import { SelectionGate } from '@/components/visibility/selection-gate';
import type { Visibility } from '@citeladder/contracts';
import {
  VisibilityActions,
  useVisibilityFilterMenu,
} from '@/components/visibility/visibility-toolbar';
import { VisibilityTrends } from '@/components/visibility/visibility-trends';
import type { FilterDefinition } from '@/components/ui/all-filters';
import { TabPanel, TabsRoot } from '@/components/ui/tabs';
import { ListScreen } from '@/components/layout/page-shell';
import { QueryState } from '@/components/ui/query-state';
import { Stack } from '@/components/ui/layout';
import { useBrandFacts } from '@/lib/project/use-brand-facts';
import { visibleTabs, type VisibilityTab } from '@/lib/visibility/dashboard';
import {
  EVIDENCE_LIMIT,
  useVisibilityFilters,
  useVisibilityQueries,
} from '@/lib/visibility/use-visibility-dashboard';

type VisibilityDashboardState = 'loading' | 'error' | 'empty' | null;

export function VisibilityDashboard() {
  const filters = useVisibilityFilters();
  const queries = useVisibilityQueries(filters);
  const state = dashboardState(
    queries.auditsQuery.isLoading,
    queries.auditsQuery.isError,
    queries.hasRuns,
  );
  // The Sources filters are listed in the page's All filters but stay owned
  // by the Sources panel; the provider spans both.
  return <VisibilityWorkspace filters={filters} queries={queries} state={state} />;
}

function dashboardState(
  auditsLoading: boolean,
  auditsError: boolean,
  hasRuns: boolean,
): VisibilityDashboardState {
  if (auditsLoading) return 'loading';
  if (auditsError) return 'error';
  if (!hasRuns) return 'empty';
  return null;
}

function DashboardState({
  state,
  auditsQuery,
}: Readonly<{
  state: Exclude<VisibilityDashboardState, 'empty' | null>;
  auditsQuery: ReturnType<typeof useVisibilityQueries>['auditsQuery'];
}>) {
  if (state === 'loading') return <QueryState kind="loading" label="Loading visibility…" />;
  if (state === 'error')
    return (
      <QueryState
        kind="error"
        error={auditsQuery.error}
        fallback="Could not load this project's runs. Check your connection and try again."
        onRetry={() => void auditsQuery.refetch()}
        pending={auditsQuery.isFetching}
      />
    );
  return null;
}

function VisibilityWorkspace({
  filters,
  queries,
  state,
}: Readonly<{
  filters: ReturnType<typeof useVisibilityFilters>;
  queries: ReturnType<typeof useVisibilityQueries>;
  state: VisibilityDashboardState;
}>) {
  // The Accuracy tab exists only inside the fact-checking pilot.
  const factChecking = useBrandFacts().data?.enabled ?? false;
  const pageFilters = useVisibilityPageFilters({ filters, queries });
  if (state === 'empty') {
    return (
      <ListScreen actions={<VisibilityActions />}>
        {queries.activeRun ? <ActiveRunBanner run={queries.activeRun} /> : null}
        <VisibilityEmptyState hasActiveRun={Boolean(queries.activeRun)} />
      </ListScreen>
    );
  }
  // The root spans the whole page: the filters every tab shares follow the
  // strip (D60), and the panels are one band below. A table's own filters
  // lead its toolbar.
  return (
    <TabsRoot value={filters.activeTab} onValueChange={filters.selectTab}>
      <ListScreen
        actions={<VisibilityActions />}
        tabs={{
          items: visibleTabs(factChecking).map((tab) => ({
            value: tab.id,
            label: tab.label,
          })),
          ariaLabel: 'Visibility views',
          onIntent: queries.prefetchTab,
        }}
        controls={{ filters: pageFilters }}
      >
        {queries.activeRun ? <ActiveRunBanner run={queries.activeRun} /> : null}
        <TabPanel value={filters.activeTab} className="focus-ring">
          {state ? (
            <DashboardState state={state} auditsQuery={queries.auditsQuery} />
          ) : (
            <DashboardPanel filters={filters} queries={queries} />
          )}
        </TabPanel>
      </ListScreen>
    </TabsRoot>
  );
}

/**
 * The page's All filters: the filters every tab shares (measurement, surface,
 * prompts, period). A tab's table keeps its own in its toolbar.
 */
function useVisibilityPageFilters({
  filters,
  queries,
}: Readonly<{
  filters: ReturnType<typeof useVisibilityFilters>;
  queries: ReturnType<typeof useVisibilityQueries>;
}>): readonly FilterDefinition[] {
  return useVisibilityFilterMenu({
    activeTab: filters.activeTab,
    runs: queries.runOptions,
    selectedRunId: filters.selectedRunId,
    onSelectMeasurement: filters.selectMeasurement,
    engine: filters.engine,
    onChangeEngine: filters.setEngine,
    promptOptions: queries.promptOptions,
    promptId: filters.promptId,
    onChangePrompt: filters.setPromptId,
    range: filters.range,
    onChangeRange: filters.setRange,
    granularity: filters.granularity,
    onChangeGranularity: filters.setGranularity,
    cohort: filters.cohort,
    onChangeCohort: filters.setCohort,
    selectionMode: filters.selectionMode,
    onChangeSelectionMode: filters.setSelectionMode,
    outcome: filters.outcome,
    onChangeOutcome: filters.setOutcome,
    markets: queries.markets,
    market: filters.market,
    onChangeMarket: filters.setMarket,
  });
}

function DashboardPanel({
  filters,
  queries,
}: Readonly<{
  filters: ReturnType<typeof useVisibilityFilters>;
  queries: ReturnType<typeof useVisibilityQueries>;
}>) {
  // Every panel below reads the selection's run, so each waits behind the
  // selection's own state; the market table reads the project and does not.
  const gated = (panel: (selected: Visibility) => ReactNode) => (
    <SelectionGate query={queries.visibilityQuery}>{panel}</SelectionGate>
  );
  const panels: Partial<Record<VisibilityTab, ReactNode>> = {
    trends: (
      <Stack gap="workspace">
        <VisibilityByMarket
          query={queries.marketRowsQuery}
          markets={queries.markets}
          market={filters.market}
          onSelectMarket={filters.setMarket}
        />
        {gated((selected) => (
          <VisibilityTrends
            query={queries.trendQuery}
            selected={selected}
            selectionBusy={queries.visibilityQuery.isFetching}
            engineFilter={filters.engine}
            surfaceRatesQuery={queries.surfaceRatesQuery}
            surfaceEngine={queries.surfaceEngine}
            hasRuns={queries.hasRuns}
            isFiltered={filters.isTrendFiltered}
            onEvidence={filters.openEvidence}
          />
        ))}
      </Stack>
    ),
    sources: gated(() => <VisibilitySources filters={filters} queries={queries} />),
    perception: gated(() => <VisibilityPerception filters={filters} queries={queries} />),
    accuracy: gated(() => <VisibilityAccuracy filters={filters} queries={queries} />),
    ads: gated(() => <VisibilityAds filters={filters} queries={queries} />),
    'query-fanout': gated(() => (
      <FanoutEvidence
        query={queries.evidenceQuery}
        isFiltered={filters.isFiltered}
        onClearFilters={filters.clearEvidenceFilters}
        limit={EVIDENCE_LIMIT}
        runId={queries.activeRunId}
        scope={queries.evidenceScope}
        scopeReady={queries.hasEvidenceScope}
        scopeNarrowed={queries.evidenceScopeNarrowed}
      />
    )),
  };
  return panels[filters.activeTab] ?? null;
}
