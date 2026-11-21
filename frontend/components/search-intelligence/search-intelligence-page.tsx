import { useState } from 'react';
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReactNode } from 'react';

import {
  DemandActions,
  DemandPanel,
  demandControls,
  useDemand,
} from '@/components/demand/demand-projection';
import { RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { ReportPage } from '@/components/templates/report-page';
import { FilterBar } from '@/components/ui/filter-bar';
import { SearchIntelligenceCitationMatcher } from '@/components/search-intelligence/search-intelligence-citation-matcher';
import { SearchIntelligenceCollection } from './search-intelligence-collection';
import { useSearchCollection, type SearchCollection } from './search-intelligence-collection-state';
import { SearchIntelligenceReviewDrawer } from '@/components/search-intelligence/search-intelligence-review-drawer';
import { SearchIntelligenceOverview } from '@/components/search-intelligence/search-intelligence-overview';
import { referringLists } from './search-intelligence-format';
import { NoAnalysisYet, NotConnected, UnavailableNotice } from './search-intelligence-availability';
import { Icon } from '@/components/ui/icon';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { CostDetails, RunNotice } from './search-intelligence-runs';
import { Button } from '@/components/ui/button';
import { MastheadPrimary } from '@/components/ui/masthead-actions';
import { Drawer } from '@/components/ui/drawer';
import { TextLink } from '@/components/ui/text-link';
import type { FilterDefinition } from '@/components/ui/all-filters';
import { savedViewFilters, scopeControls } from './search-intelligence-scope';
import { Stack } from '@/components/ui/layout';
import { TabPanel, TabRow, TabsRoot } from '@/components/ui/tabs';
import {
  searchIntelligenceMutations,
  searchIntelligenceQueries,
  type SearchIntelligenceDataset,
  type SearchIntelligenceReadiness,
  type SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import type { SearchReviewAction } from '@citeladder/contracts/search-intelligence-requests';
import { Layers, Play, Receipt, RefreshCw, Settings2 } from '@/lib/icons';
import { searchMarketLabel } from '@/lib/config/search-intelligence';
import { pollSearchRun } from '@/lib/search-intelligence/status';
import { SEARCH_INTELLIGENCE_TABS } from '@/lib/search-intelligence/tabs';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type PageTab = (typeof SEARCH_INTELLIGENCE_TABS)[number]['value'];
type Tab = Exclude<PageTab, 'demand'>;
const RESEARCH_TABS = SEARCH_INTELLIGENCE_TABS.flatMap(({ value }) =>
  value === 'demand' ? [] : [value],
);
const TAB_CODEC = stringUrlCodec(
  SEARCH_INTELLIGENCE_TABS.map(({ value }) => value),
  'demand' as PageTab,
);
const DEMAND_KEYS = ['view', 'signal', 'page', 'page_size'];
function selectDatasets(
  readiness: SearchIntelligenceReadiness | undefined,
  scope: string,
  market: string,
) {
  const latestDatasets = readiness?.datasets ?? [];
  const offered = readiness?.markets ?? [];
  const scopes = [...new Set(latestDatasets.map((item) => item.research_scope ?? 'exact_host'))];
  const activeScope = scopes.includes(scope as 'exact_host' | 'domain_subdomains')
    ? scope
    : scopes[0];
  const markets = [
    ...new Map(
      latestDatasets
        .filter(
          (item) =>
            (item.research_scope ?? 'exact_host') === activeScope && item.location_code !== null,
        )
        .map((item) => [
          `${item.location_code}:${item.language_code}`,
          {
            value: `${item.location_code}:${item.language_code}`,
            label: `${searchMarketLabel(item.location_code, offered)} · ${item.language_code}`,
          },
        ]),
    ).values(),
  ];
  const activeMarket = markets.find((item) => item.value === market)?.value ?? markets[0]?.value;
  const datasets = latestDatasets.filter(
    (item) =>
      (item.research_scope ?? 'exact_host') === activeScope &&
      (item.location_code === null ||
        `${item.location_code}:${item.language_code}` === activeMarket),
  );
  return { scopes, activeScope, markets, activeMarket, datasets };
}

export function SearchIntelligencePage() {
  const [tab, setTab] = useUrlState('tab', TAB_CODEC, { clearKeys: DEMAND_KEYS });
  const demand = useDemand();
  const research = useKeywordResearch({ tab, setTab });
  return (
    <TabsRoot value={tab} onValueChange={setTab}>
      <ReportPage
        actions={
          <PageActions {...research.actions}>
            <DemandActions demand={demand} />
          </PageActions>
        }
        tabs={<TabRow items={SEARCH_INTELLIGENCE_TABS} ariaLabel="Keyword research views" />}
        filters={tab === 'demand' ? demandControls(demand) : research.filters}
      >
        <TabPanel value="demand" className="min-w-0">
          <Stack gap="section">
            <DemandPanel demand={demand} />
          </Stack>
        </TabPanel>
        {tab === 'demand' ? null : research.body}
        {research.overlays}
      </ReportPage>
    </TabsRoot>
  );
}

function statePanels(render: (tab: Tab) => ReactNode) {
  return RESEARCH_TABS.map((value) => (
    <TabPanel key={value} value={value} className="min-w-0">
      {render(value)}
    </TabPanel>
  ));
}

function useKeywordResearch({
  tab,
  setTab,
}: Readonly<{ tab: PageTab; setTab: (tab: PageTab) => void }>) {
  const { workspaceId, projectId } = useProjectScope();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [citationOpen, setCitationOpen] = useState(false);
  const [citationOrigin, setCitationOrigin] = useState<string>();
  const [comparison, setComparison] = useState<SearchIntelligenceDataset | null>(null);
  const [market, setMarket] = useState('');
  const [scope, setScope] = useState('');
  const [action, setAction] = useState<SearchReviewAction>('analysis');
  const requestScope = { workspaceId, projectId };
  const readiness = useQuery({
    ...searchIntelligenceQueries.readiness(requestScope),
    refetchInterval: (query) => pollSearchRun(query.state.data?.latest_run?.status),
  });
  const runsQuery = useQuery({
    ...searchIntelligenceQueries.runs(requestScope),
    enabled: costOpen,
  });
  const cancelMutation = useMutation(searchIntelligenceMutations.cancel(requestScope));
  const reviewMutation = useMutation(searchIntelligenceMutations.review(requestScope));
  const confirmMutation = useMutation(searchIntelligenceMutations.confirm(requestScope));
  const openReview = (nextAction: SearchReviewAction) => {
    setAction(nextAction);
    setDrawerOpen(true);
  };
  const actions = useRoleActions({
    openReview,
    cancel: (runId) => cancelMutation.mutate(runId),
    openMatch: (origin) => {
      setCitationOrigin(origin);
      setCitationOpen(true);
    },
  });
  const { scopes, activeScope, markets, activeMarket, datasets } = selectDatasets(
    readiness.data,
    scope,
    market,
  );
  const collection = useSearchCollection({
    tab: tab === 'overview' || tab === 'demand' ? null : tab,
    datasets,
    competitors: readiness.data?.competitors ?? [],
    selected: comparison,
    onSelect: setComparison,
  });
  const data = readiness.data;
  const overlays = (
    <>
      <Drawer open={citationOpen} onOpenChange={setCitationOpen} title="Match Visibility citations">
        <SearchIntelligenceCitationMatcher
          key={citationOrigin}
          datasets={datasets}
          targetOrigin={citationOrigin}
          onDerived={() => setCitationOpen(false)}
        />
      </Drawer>
      <CostDetails
        open={costOpen}
        onOpenChange={setCostOpen}
        runs={runsQuery.data}
        pending={runsQuery.isPending}
        error={runsQuery.error}
        onRetry={() => void runsQuery.refetch()}
      />
      {data ? (
        <SearchIntelligenceReviewDrawer
          key={`${workspaceId}:${projectId}:${action}:${drawerOpen}`}
          open={drawerOpen}
          action={action}
          readiness={data}
          onOpenChange={setDrawerOpen}
          onReview={(payload) =>
            reviewMutation.mutateAsync(payload) as Promise<SearchIntelligenceRun>
          }
          onConfirm={async (runId) => {
            await confirmMutation.mutateAsync(runId);
            setDrawerOpen(false);
          }}
          busy={reviewMutation.isPending || confirmMutation.isPending}
        />
      ) : null}
    </>
  );
  const empty = !data?.datasets.length;
  const pageActions = {
    hasDatasets: !empty && Boolean(data?.owned_targets.length),
    onReview: actions.review,
    onCost: () => setCostOpen(true),
  };
  return {
    actions: pageActions,
    overlays,
    ...researchView({
      readiness,
      tab,
      empty,
      datasets,
      collection,
      actions,
      cancelling: cancelMutation.isPending,
      savedView: (researchTab) =>
        savedViewFilters({
          scopes,
          scope: activeScope,
          markets,
          market: activeMarket,
          tab: researchTab,
          onScope: (value) => {
            setScope(value);
            setComparison(null);
          },
          onMarket: (value) => {
            setMarket(value);
            setComparison(null);
          },
        }),
      onOpen: (dataset) => {
        setComparison(dataset);
        setTab('competitors');
      },
      onSelect: setComparison,
    }),
  };
}

function researchView({
  readiness,
  tab,
  empty,
  datasets,
  collection,
  actions,
  cancelling,
  savedView,
  onOpen,
  onSelect,
}: Readonly<{
  readiness: UseQueryResult<SearchIntelligenceReadiness>;
  tab: PageTab;
  empty: boolean;
  datasets: SearchIntelligenceDataset[];
  collection: SearchCollection | null;
  actions: ReturnType<typeof useRoleActions>;
  cancelling: boolean;
  savedView: (tab: Tab) => FilterDefinition[];
  onOpen: (dataset: SearchIntelligenceDataset) => void;
  onSelect: (dataset: SearchIntelligenceDataset | null) => void;
}>): Readonly<{ filters?: ReactNode; body: ReactNode }> {
  if (readiness.isPending)
    return {
      filters: <FilterBar {...RESERVED_CONTROLS} />,
      body: statePanels((value) => <ResearchLoading tab={value} />),
    };
  if (readiness.isError)
    return {
      body: statePanels(() => (
        <StateBlock
          kind="error"
          {...readErrorProps(readiness)}
          fallback="Keyword research could not be loaded."
          title="Keyword research could not be loaded"
        />
      )),
    };
  const loaded = readiness.data;
  if (!loaded.connected && !loaded.datasets.length)
    return {
      body: statePanels(() => <NotConnected />),
    };
  if (!loaded.owned_targets.length)
    return {
      body: statePanels(() => (
        <StateBlock
          kind="empty"
          icon={Settings2}
          heading="Add your website address"
          action={<TextLink href="/projects">Edit the project</TextLink>}
        />
      )),
    };
  const firstRun = actions.analysis ? (
    <Button onClick={actions.analysis}>
      <Icon icon={Play} />
      Review first analysis
    </Button>
  ) : undefined;
  return {
    filters:
      tab === 'demand' ? undefined : (
        <FilterBar
          {...pageControls({
            data: loaded,
            tab,
            datasets,
            collection: empty ? null : collection,
            onSeed: actions.onSeed,
            onMatch: actions.onMatch,
            onExpand: actions.onExpand,
            savedView: savedView(tab),
          })}
        />
      ),
    body: (
      <Stack gap="workspace" className="min-w-0">
        <UnavailableNotice data={loaded} />
        <RunNotice
          run={loaded.latest_run}
          onCancel={actions.cancel}
          onReview={actions.analysis}
          cancelling={cancelling}
        />
        {empty ? (
          statePanels((value) => <NoAnalysisYet tab={value} action={firstRun} />)
        ) : (
          <ResearchPanels
            data={loaded}
            datasets={datasets}
            collection={collection}
            onOpen={onOpen}
            onSelect={onSelect}
          />
        )}
      </Stack>
    ),
  };
}

/**
 * The page's actions, each only for a role that may take it: reviews and
 * cancels start or stop DataForSEO spend (run); saving citation matches is a write.
 */
function useRoleActions({
  openReview,
  cancel,
  openMatch,
}: Readonly<{
  openReview: (action: SearchReviewAction) => void;
  cancel: (runId: string) => void;
  openMatch: (targetOrigin: string | undefined) => void;
}>): Readonly<
  CollectionActions & {
    review?: (action: SearchReviewAction) => void;
    analysis?: () => void;
    cancel?: (runId: string) => void;
  }
> {
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const onMatch = canWrite ? openMatch : undefined;
  if (!canRun) return { onMatch };
  return {
    review: openReview,
    analysis: () => openReview('analysis'),
    cancel,
    onSeed: () => openReview('seed'),
    onExpand: () => openReview('increase_depth'),
    onMatch,
  };
}

function ResearchLoading({ tab }: Readonly<{ tab: Tab }>) {
  if (tab === 'overview') return <Skeleton variant="stat" count={5} label="Loading keywords…" />;
  return (
    <Section>
      <Skeleton variant="table" columns={6} label="Loading keywords…" />
    </Section>
  );
}

function ResearchPanels({
  data,
  datasets,
  collection,
  onOpen,
  onSelect,
}: Readonly<{
  data: SearchIntelligenceReadiness;
  datasets: SearchIntelligenceDataset[];
  collection: ReturnType<typeof useSearchCollection>;
  onOpen: (dataset: SearchIntelligenceDataset) => void;
  onSelect: (dataset: SearchIntelligenceDataset | null) => void;
}>) {
  return (
    <>
      <TabPanel value="overview" className="min-w-0">
        <SearchIntelligenceOverview
          datasets={datasets}
          competitors={data.competitors}
          ownedHostname={data.owned_targets[0]?.hostname ?? ''}
          onOpen={onOpen}
        />
      </TabPanel>
      {RESEARCH_TABS.filter((value) => value !== 'overview').map((value) => (
        <TabPanel key={value} value={value} className="min-w-0">
          {collection?.tab === value ? (
            <SearchIntelligenceCollection
              collection={collection}
              datasets={datasets}
              competitors={data.competitors}
              onSelect={onSelect}
            />
          ) : null}
        </TabPanel>
      ))}
    </>
  );
}

function PageActions({
  hasDatasets,
  onReview,
  onCost,
  children,
}: Readonly<{
  hasDatasets: boolean;
  /** Opens a review of paid provider work; omitted for a role that may not run one. */
  onReview?: (action: SearchReviewAction) => void;
  onCost: () => void;
  children: ReactNode;
}>) {
  return (
    <>
      <Button variant="quiet" onClick={onCost}>
        <Icon icon={Receipt} />
        Cost details
      </Button>
      {children}
      {onReview && hasDatasets ? (
        <>
          <Button variant="secondary" onClick={() => onReview('refresh')}>
            <Icon icon={RefreshCw} />
            Refresh
          </Button>
          <MastheadPrimary>
            <Button variant="primary" onClick={() => onReview('analysis')}>
              New analysis
            </Button>
          </MastheadPrimary>
        </>
      ) : null}
    </>
  );
}

function pageControls({
  data,
  tab,
  datasets,
  collection,
  savedView,
  ...actions
}: Readonly<
  {
    data: SearchIntelligenceReadiness;
    tab: Tab;
    datasets: SearchIntelligenceDataset[];
    collection: SearchCollection | null;
    savedView: FilterDefinition[];
  } & CollectionActions
>) {
  const newest = datasets.find((item) =>
    tab === 'backlinks' ? item.location_code === null : item.location_code !== null,
  );
  return scopeControls({
    data,
    tab,
    latest: collection?.dataset ?? newest,
    savedView,
    collection: collection ?? undefined,
    action: collection ? (
      <CollectionAction collection={collection} datasets={datasets} {...actions} />
    ) : undefined,
  });
}

type CollectionActions = {
  onSeed?: () => void;
  onMatch?: (targetOrigin: string | undefined) => void;
  onExpand?: () => void;
};

function CollectionAction({
  collection,
  datasets,
  onSeed,
  onMatch,
  onExpand,
}: Readonly<
  {
    collection: SearchCollection;
    datasets: SearchIntelligenceDataset[];
  } & CollectionActions
>) {
  const matchable =
    collection.tab === 'backlinks' &&
    referringLists(datasets).some((dataset) => dataset.target_origin === collection.target);
  const expandable = !collection.listingCompetitors && Boolean(collection.dataset);
  return (
    <>
      {collection.tab === 'keywords' && onSeed ? (
        <Button variant="secondary" onClick={onSeed}>
          Research a keyword
        </Button>
      ) : null}
      {matchable && onMatch ? (
        <Button variant="secondary" onClick={() => onMatch(collection.target)}>
          Match with Visibility citations
        </Button>
      ) : null}
      {expandable && onExpand ? (
        <Button variant="quiet" onClick={onExpand}>
          <Icon icon={Layers} />
          Review depth
        </Button>
      ) : null}
    </>
  );
}
