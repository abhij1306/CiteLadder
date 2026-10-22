'use client';

import type { ReactNode } from 'react';

import { ActiveRunBanner } from '@/components/visibility/active-run-banner';
import { VisibilityEmptyState } from '@/components/visibility/empty-state';
import { FanoutEvidence } from '@/components/visibility/fanout-evidence';
import { VisibilitySources } from '@/components/visibility/visibility-sources';
import { VisibilityPerception } from '@/components/visibility/visibility-perception';
import { VisibilityAccuracy } from '@/components/visibility/visibility-accuracy';
import { VisibilityAds } from '@/components/visibility/visibility-ads';
import { VisibilityByMarket } from '@/components/visibility/visibility-by-market';
import { VisibilityActions, VisibilityToolbar } from '@/components/visibility/visibility-toolbar';
import { VisibilityTrends } from '@/components/visibility/visibility-trends';
import { TabPanel, TabsRoot } from '@/components/ui/tabs';
import { ListScreen } from '@/components/layout/page-shell';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { QueryState } from '@/components/ui/query-state';
import { Stack } from '@/components/ui/layout';
import { useProjectContext } from '@/lib/project/project-context';
import { useBrandFacts } from '@/lib/project/use-brand-facts';
import { visibleTabs, type VisibilityTab } from '@/lib/visibility/dashboard';
import {
  EVIDENCE_LIMIT,
  useVisibilityFilters,
  useVisibilityQueries,
} from '@/lib/visibility/use-visibility-dashboard';

type VisibilityDashboardState = 'loading' | 'missing-project' | 'error' | 'empty' | null;

export function VisibilityDashboard() {
  const { activeProject, isLoading: projectLoading } = useProjectContext();
  const projectId = activeProject?.id ?? null;
  const filters = useVisibilityFilters();
  const queries = useVisibilityQueries(projectId, filters);
  const state = dashboardState(
    projectId,
    projectLoading,
    queries.auditsQuery.isLoading,
    queries.auditsQuery.isError,
    queries.hasRuns,
  );
  return <VisibilityWorkspace filters={filters} queries={queries} state={state} />;
}

function dashboardState(
  projectId: string | null,
  projectLoading: boolean,
  auditsLoading: boolean,
  auditsError: boolean,
  hasRuns: boolean,
): VisibilityDashboardState {
  if (projectLoading || (Boolean(projectId) && auditsLoading)) return 'loading';
  if (!projectId) return 'missing-project';
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
  if (state === 'missing-project') return <ProjectRequiredState />;
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
  const factChecking =
    useBrandFacts(queries.projectId ?? null, queries.workspaceId ?? null).data?.enabled ?? false;
  if (state === 'empty') {
    return (
      <ListScreen actions={<VisibilityActions />}>
        {queries.activeRun ? <ActiveRunBanner run={queries.activeRun} /> : null}
        <VisibilityEmptyState hasActiveRun={Boolean(queries.activeRun)} />
      </ListScreen>
    );
  }
  // The root spans the whole page: the strip is the navigation band and its
  // panels are two bands below, in the content region.
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
        controls={{
          filters: (
            <VisibilityToolbar
              activeTab={filters.activeTab}
              runs={queries.runOptions}
              selectedRunId={filters.selectedRunId}
              onSelectMeasurement={filters.selectMeasurement}
              engine={filters.engine}
              onChangeEngine={filters.setEngine}
              promptOptions={queries.promptOptions}
              promptId={filters.promptId}
              onChangePrompt={filters.setPromptId}
              range={filters.range}
              onChangeRange={filters.setRange}
              granularity={filters.granularity}
              onChangeGranularity={filters.setGranularity}
              cohort={filters.cohort}
              onChangeCohort={filters.setCohort}
              selectionMode={filters.selectionMode}
              onChangeSelectionMode={filters.setSelectionMode}
              outcome={filters.outcome}
              onChangeOutcome={filters.setOutcome}
              markets={queries.markets}
              market={filters.market}
              onChangeMarket={filters.setMarket}
            />
          ),
        }}
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

function DashboardPanel({
  filters,
  queries,
}: Readonly<{
  filters: ReturnType<typeof useVisibilityFilters>;
  queries: ReturnType<typeof useVisibilityQueries>;
}>) {
  const panels: Partial<Record<VisibilityTab, ReactNode>> = {
    trends: (
      <Stack gap="workspace">
        <VisibilityByMarket
          query={queries.marketRowsQuery}
          markets={queries.markets}
          market={filters.market}
          onSelectMarket={filters.setMarket}
        />
        <VisibilityTrends
          query={queries.trendQuery}
          visibilityQuery={queries.visibilityQuery}
          engineFilter={filters.engine}
          surfaceRatesQuery={queries.surfaceRatesQuery}
          surfaceEngine={queries.surfaceEngine}
          hasRuns={queries.hasRuns}
          isFiltered={filters.isTrendFiltered}
          onEvidence={filters.openEvidence}
        />
      </Stack>
    ),
    sources: <VisibilitySources filters={filters} queries={queries} />,
    perception: <VisibilityPerception filters={filters} queries={queries} />,
    accuracy: <VisibilityAccuracy filters={filters} queries={queries} />,
    ads: <VisibilityAds filters={filters} queries={queries} />,
    'query-fanout': (
      <FanoutEvidence
        query={queries.evidenceQuery}
        isFiltered={filters.isFiltered}
        onClearFilters={filters.clearEvidenceFilters}
        limit={EVIDENCE_LIMIT}
        projectId={queries.projectId}
        runId={queries.activeRunId}
        scope={queries.evidenceScope}
        scopeReady={queries.hasEvidenceScope}
        scopeNarrowed={queries.evidenceScopeNarrowed}
      />
    ),
  };
  return panels[filters.activeTab] ?? null;
}
