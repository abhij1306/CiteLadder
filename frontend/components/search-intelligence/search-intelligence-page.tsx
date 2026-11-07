'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Settings2, Unplug } from 'lucide-react';

import { ListScreen, RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { SearchIntelligenceCitationMatcher } from '@/components/search-intelligence/search-intelligence-citation-matcher';
import { SearchIntelligenceCollection } from './search-intelligence-collection';
import { SearchIntelligenceReviewDrawer } from '@/components/search-intelligence/search-intelligence-review-drawer';
import { SearchIntelligenceOverview } from '@/components/search-intelligence/search-intelligence-overview';
import { referringLists } from './search-intelligence-format';
import { CostDetails, RunNotice } from './search-intelligence-runs';
import { Callout } from '@/components/ui/callout';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { SavedViewControls, scopeControls } from './search-intelligence-scope';
import { Stack } from '@/components/ui/layout';
import { TabPanel, TabsRoot } from '@/components/ui/tabs';
import {
  searchIntelligenceMutations,
  searchIntelligenceQueries,
  type SearchIntelligenceDataset,
  type SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import type { SearchReviewAction } from '@citeladder/contracts/search-intelligence-requests';
import { searchMarketLabel } from '@/lib/config/search-intelligence';
import { pollSearchRun } from '@/lib/search-intelligence/status';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectContext } from '@/lib/project/project-context';
import { resolveActiveProjectRequestScope } from '@/lib/project/request-scope';

const PROVIDER_SETTINGS = '/settings?tab=providers';
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'keywords', label: 'Keywords' },
  { value: 'competitors', label: 'Competitors' },
  { value: 'backlinks', label: 'Backlinks' },
] as const;
type Tab = (typeof TABS)[number]['value'];
const SEARCH_INTELLIGENCE_TABS = { items: TABS, ariaLabel: 'Keyword Research views' };
const TAB_CODEC = stringUrlCodec(
  TABS.map(({ value }) => value),
  'overview' as Tab,
);
/**
 * The research scopes and markets the saved datasets offer, the chosen ones
 * (or the first offered), and the datasets they select. The server already
 * answers only the newest dataset of each acquisition identity.
 */
function selectDatasets(
  latestDatasets: readonly SearchIntelligenceDataset[],
  scope: string,
  market: string,
) {
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
            label: `${searchMarketLabel(item.location_code)} · ${item.language_code}`,
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
  const { activeProject } = useProjectContext();
  const [tab, setTab] = useUrlState('tab', TAB_CODEC);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [citationOpen, setCitationOpen] = useState(false);
  const [citationOrigin, setCitationOrigin] = useState<string>();
  const [comparison, setComparison] = useState<SearchIntelligenceDataset | null>(null);
  const [market, setMarket] = useState('');
  const [scope, setScope] = useState('');
  const [action, setAction] = useState<SearchReviewAction>('analysis');
  const requestScope = resolveActiveProjectRequestScope(activeProject);
  const readiness = useQuery({
    ...searchIntelligenceQueries.readiness(requestScope),
    enabled: requestScope.enabled,
    refetchInterval: (query) => pollSearchRun(query.state.data?.latest_run?.status),
  });
  const runsQuery = useQuery({
    ...searchIntelligenceQueries.runs(requestScope),
    enabled: requestScope.enabled && costOpen,
  });
  const cancelMutation = useMutation(searchIntelligenceMutations.cancel(requestScope));
  const reviewMutation = useMutation(searchIntelligenceMutations.review(requestScope));
  const confirmMutation = useMutation(searchIntelligenceMutations.confirm(requestScope));
  const openReview = (nextAction: SearchReviewAction) => {
    setAction(nextAction);
    setDrawerOpen(true);
  };
  const { scopes, activeScope, markets, activeMarket, datasets } = selectDatasets(
    readiness.data?.datasets ?? [],
    scope,
    market,
  );
  const openComparison = (dataset: SearchIntelligenceDataset) => {
    setComparison(dataset);
    setTab('competitors');
  };
  // The first load draws the tab row and the control band the loaded page
  // has, so the work starts on the same line before and after.
  if (readiness.isPending)
    return (
      <TabsRoot value={tab} onValueChange={setTab}>
        <ListScreen tabs={SEARCH_INTELLIGENCE_TABS} controls={RESERVED_CONTROLS}>
          <QueryState kind="loading" label="Loading Keyword Research…" />
        </ListScreen>
      </TabsRoot>
    );
  if (readiness.isError)
    return (
      <ListScreen>
        <QueryState
          kind="error"
          {...readErrorProps(readiness)}
          fallback="Keyword Research could not be loaded."
        />
      </ListScreen>
    );
  const data = readiness.data;
  const tabs = SEARCH_INTELLIGENCE_TABS;
  if (!data.connected && !data.datasets.length)
    return (
      <TabsRoot value={tab} onValueChange={setTab}>
        <ListScreen tabs={tabs}>
          <QueryState
            kind="empty"
            icon={Unplug}
            heading="Connect DataForSEO"
            description="Keyword Research uses your workspace’s own DataForSEO account. Add its login once; every analysis shows its cost before anything is fetched."
            action={<TextLink href={PROVIDER_SETTINGS}>Open provider settings</TextLink>}
          />
        </ListScreen>
      </TabsRoot>
    );
  if (!data.owned_targets.length)
    return (
      <TabsRoot value={tab} onValueChange={setTab}>
        <ListScreen tabs={tabs}>
          <QueryState
            kind="empty"
            icon={Settings2}
            heading="Add your website address"
            description="Keyword Research studies the project’s own website, so the project needs its homepage address (for example https://www.example.com)."
            action={<TextLink href="/projects">Edit the project</TextLink>}
          />
        </ListScreen>
      </TabsRoot>
    );
  const firstRun = (
    <Button variant="primary" onClick={() => openReview('analysis')}>
      Review first analysis
    </Button>
  );
  return (
    <TabsRoot value={tab} onValueChange={setTab}>
      <ListScreen
        tabs={tabs}
        actions={
          <PageActions
            hasDatasets={Boolean(data.datasets.length)}
            onReview={openReview}
            onCost={() => setCostOpen(true)}
          />
        }
        controls={scopeControls({
          data,
          tab,
          latest: datasets.find((item) =>
            tab === 'backlinks' ? item.location_code === null : item.location_code !== null,
          ),
          marketControl: (
            <SavedViewControls
              scopes={scopes}
              scope={activeScope}
              markets={markets}
              market={activeMarket}
              tab={tab}
              onScope={(value) => {
                setScope(value);
                setComparison(null);
              }}
              onMarket={(value) => {
                setMarket(value);
                setComparison(null);
              }}
            />
          ),
        })}
      >
        <Stack gap="workspace" className="min-w-0">
          <UnavailableNotice data={data} />
          <RunNotice
            run={data.latest_run}
            onCancel={(runId) => cancelMutation.mutate(runId)}
            cancelling={cancelMutation.isPending}
          />
          <TabPanel value="overview" className="min-w-0">
            <SearchIntelligenceOverview
              datasets={datasets}
              competitors={data.competitors}
              ownedHostname={data.owned_targets[0]?.hostname ?? ''}
              onOpen={openComparison}
              firstRun={firstRun}
            />
          </TabPanel>
          {TABS.filter((item) => item.value !== 'overview').map(({ value }) => (
            <TabPanel key={value} value={value} className="min-w-0">
              <SearchIntelligenceCollection
                tab={value}
                datasets={datasets}
                competitors={data.competitors}
                selected={value === 'competitors' ? comparison : null}
                onSelect={setComparison}
                onExpand={() => openReview('increase_depth')}
                action={(targetOrigin) => (
                  // NOSONAR -- a render prop the collection calls, never mounted as a component type
                  <CollectionAction
                    tab={value}
                    datasets={datasets}
                    targetOrigin={targetOrigin}
                    onSeed={() => openReview('seed')}
                    onMatch={() => {
                      setCitationOrigin(targetOrigin);
                      setCitationOpen(true);
                    }}
                  />
                )}
              />
            </TabPanel>
          ))}
          <Drawer
            open={citationOpen}
            onOpenChange={setCitationOpen}
            title="Match Visibility citations"
            description="Find the sources AI answers cite that already link to your website."
          >
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
          <SearchIntelligenceReviewDrawer
            key={`${activeProject?.workspace_id}:${activeProject?.id}:${action}:${drawerOpen}`}
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
        </Stack>
      </ListScreen>
    </TabsRoot>
  );
}

function PageActions({
  hasDatasets,
  onReview,
  onCost,
}: Readonly<{
  hasDatasets: boolean;
  onReview: (action: SearchReviewAction) => void;
  onCost: () => void;
}>) {
  return (
    <>
      <Button variant="ghost" onClick={onCost}>
        Cost details
      </Button>
      {hasDatasets ? (
        <>
          <Button variant="secondary" onClick={() => onReview('analysis')}>
            New analysis
          </Button>
          <Button variant="primary" onClick={() => onReview('refresh')}>
            Refresh
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={() => onReview('analysis')}>
          Review first analysis
        </Button>
      )}
    </>
  );
}

/** The tab's own next step beside its view switcher. */
function CollectionAction({
  tab,
  datasets,
  targetOrigin,
  onSeed,
  onMatch,
}: Readonly<{
  tab: string;
  datasets: SearchIntelligenceDataset[];
  /** The website the tab is showing. */
  targetOrigin: string | undefined;
  onSeed: () => void;
  onMatch: () => void;
}>) {
  if (tab === 'keywords')
    return (
      <Button variant="secondary" onClick={onSeed}>
        Research a keyword
      </Button>
    );
  // Only the website on screen: matching another website's list would save
  // matches for a site the reader is not looking at.
  if (
    tab === 'backlinks' &&
    referringLists(datasets).some((dataset) => dataset.target_origin === targetOrigin)
  )
    return (
      <Button variant="secondary" onClick={onMatch}>
        Match with Visibility citations
      </Button>
    );
  return null;
}

/** Why saved results cannot be refreshed: no DataForSEO connection. */
function UnavailableNotice({ data }: Readonly<{ data: { connected: boolean } }>) {
  if (data.connected) return null;
  return (
    <Callout tone="negative">
      DataForSEO is not connected, so saved results can be read but not refreshed.{' '}
      <TextLink href={PROVIDER_SETTINGS}>Open provider settings</TextLink>
    </Callout>
  );
}
