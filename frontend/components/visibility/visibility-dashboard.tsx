import type { ReactNode } from 'react';

import { ActiveRunBanner } from '@/components/visibility/active-run-banner';
import { FanoutEvidence } from '@/components/visibility/fanout-evidence';
import { VisibilitySources } from '@/components/visibility/visibility-sources';
import { VisibilityAds } from '@/components/visibility/visibility-ads';
import { SelectionGate } from '@/components/visibility/selection-gate';
import {
  SelectionPageStateBlock,
  selectionPageFilterBar,
  selectionPageState,
  useSelectionPageFilters,
  type SelectionPageState,
} from '@/components/visibility/selection-page';
import type { Visibility } from '@citeladder/contracts';
import { VisibilityActions } from '@/components/visibility/visibility-toolbar';
import { TabPanel, TabRow, TabsRoot } from '@/components/ui/tabs';
import { ReportPage } from '@/components/templates/report-page';
import { useTableFilters } from '@/components/visibility/table-filters';
import { VISIBILITY_TABS, type SourceTab, type VisibilityTab } from '@/lib/visibility/dashboard';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useUrlSearch } from '@/lib/navigation/url-params';
import { pathOf } from '@/lib/visibility/sources';
import { useSourceUrl } from '@/lib/visibility/use-source-analysis';
import {
  EVIDENCE_LIMIT,
  useVisibilityFilters,
  useVisibilityQueries,
} from '@/lib/visibility/use-visibility-dashboard';

export function VisibilityDashboard() {
  const filters = useVisibilityFilters();
  const queries = useVisibilityQueries(filters, filters.activeTab);
  return (
    <VisibilityWorkspace filters={filters} queries={queries} state={selectionPageState(queries)} />
  );
}

function VisibilityWorkspace({
  filters,
  queries,
  state,
}: Readonly<{
  filters: ReturnType<typeof useVisibilityFilters>;
  queries: ReturnType<typeof useVisibilityQueries>;
  state: SelectionPageState;
}>) {
  const view = filters.activeTab;
  const urlTrail = useOpenUrlTrail(filters, queries);
  const pageFilters = [
    ...useSelectionPageFilters({ view, filters, queries }),
    ...useTableFilters({ view, filters, queries }),
  ];
  return (
    <TabsRoot value={filters.activeTab} onValueChange={filters.selectTab}>
      <ReportPage
        {...urlTrail}
        actions={<VisibilityActions launch={state !== 'empty'} />}
        tabs={
          <TabRow
            items={VISIBILITY_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
            ariaLabel="Visibility views"
            onIntent={queries.prefetchTab}
          />
        }
        filters={selectionPageFilterBar(state, pageFilters)}
      >
        {queries.activeRun && state !== 'empty' ? (
          <ActiveRunBanner run={queries.activeRun} />
        ) : null}
        <TabPanel value={filters.activeTab}>
          {state ? (
            <SelectionPageStateBlock state={state} queries={queries} />
          ) : (
            <DashboardPanel filters={filters} queries={queries} />
          )}
        </TabPanel>
      </ReportPage>
    </TabsRoot>
  );
}

function useOpenUrlTrail(
  filters: ReturnType<typeof useVisibilityFilters>,
  queries: ReturnType<typeof useVisibilityQueries>,
) {
  const [openUrl] = useUrlState('source_url', optionalStringUrlCodec);
  const search = useUrlSearch();
  const detail = useSourceUrl(filters, queries, openUrl);
  if (!openUrl) return {};
  const back = new URLSearchParams(search);
  back.delete('source_url');
  return {
    trail: [{ label: 'Sources', href: `/visibility?${back.toString()}` }],
    crumb: { label: detail.data?.title?.trim() || pathOf(openUrl) },
  };
}

function DashboardPanel({
  filters,
  queries,
}: Readonly<{
  filters: ReturnType<typeof useVisibilityFilters>;
  queries: ReturnType<typeof useVisibilityQueries>;
}>) {
  const gated = (panel: (selected: Visibility) => ReactNode) => (
    <SelectionGate query={queries.visibilityQuery}>{panel}</SelectionGate>
  );
  const sources = (tab: SourceTab) =>
    gated(() => <VisibilitySources tab={tab} filters={filters} queries={queries} />);
  const panels: Record<VisibilityTab, ReactNode> = {
    domains: sources('domains'),
    urls: sources('urls'),
    'read-not-cited': sources('read-not-cited'),
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
      />
    )),
  };
  return panels[filters.activeTab];
}
