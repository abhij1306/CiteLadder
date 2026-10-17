'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, Unplug } from 'lucide-react';

import { PageLoading } from '@/components/layout/page-loading';
import { PageShell } from '@/components/layout/page-shell';
import { SearchIntelligenceCitationMatcher } from '@/components/search-intelligence/search-intelligence-citation-matcher';
import { SearchIntelligenceCollection } from './search-intelligence-collection';
import { SearchIntelligenceReviewDrawer } from '@/components/search-intelligence/search-intelligence-review-drawer';
import { SearchIntelligenceOverview } from '@/components/search-intelligence/search-intelligence-overview';
import { referringLists } from './search-intelligence-format';
import { CostDetails, RunNotice } from './search-intelligence-runs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Drawer } from '@/components/ui/drawer';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { SavedViewControls, ScopeBand } from './search-intelligence-scope';
import { Stack } from '@/components/ui/layout';
import { TabPanel, TabsBar, TabsRoot } from '@/components/ui/tabs';
import {
  searchIntelligenceApi,
  type SearchIntelligenceDataset,
  type SearchIntelligenceRun,
} from '@/lib/api/search-intelligence';
import { searchIntelligenceKeys } from '@/lib/api/query-keys/search-intelligence';
import { searchMarketLabel } from '@/lib/config/search-intelligence';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectContext } from '@/lib/project/project-context';

const PROVIDER_SETTINGS = '/settings?tab=providers';
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'keywords', label: 'Keywords' },
  { value: 'competitors', label: 'Competitors' },
  { value: 'backlinks', label: 'Backlinks' },
] as const;
type Tab = (typeof TABS)[number]['value'];
const TAB_CODEC = stringUrlCodec(
  TABS.map(({ value }) => value),
  'overview' as Tab,
);
export function SearchIntelligencePage() {
  const { activeProject } = useProjectContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useUrlState('tab', TAB_CODEC);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [citationOpen, setCitationOpen] = useState(false);
  const [citationOrigin, setCitationOrigin] = useState<string>();
  const [comparison, setComparison] = useState<SearchIntelligenceDataset | null>(null);
  const [market, setMarket] = useState('');
  const [scope, setScope] = useState('');
  const [action, setAction] = useState('analysis');
  const readiness = useQuery({
    queryKey: searchIntelligenceKeys.readiness(activeProject?.workspace_id, activeProject?.id),
    queryFn: ({ signal }) =>
      searchIntelligenceApi.readiness(activeProject!.id, {
        signal,
        workspaceId: activeProject!.workspace_id,
      }),
    enabled: Boolean(activeProject),
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.latest_run?.status ?? '') ? 5000 : false,
  });
  const runsQuery = useQuery({
    queryKey: searchIntelligenceKeys.runs(activeProject?.workspace_id, activeProject?.id),
    queryFn: ({ signal }) =>
      searchIntelligenceApi.runs(activeProject!.id, {
        signal,
        workspaceId: activeProject!.workspace_id,
      }),
    enabled: Boolean(activeProject && costOpen),
  });
  const invalidateReadiness = () =>
    queryClient.invalidateQueries({
      queryKey: searchIntelligenceKeys.readiness(activeProject?.workspace_id, activeProject?.id),
    });
  const cancelMutation = useMutation({
    mutationFn: (runId: string) =>
      searchIntelligenceApi.cancel(activeProject!.id, runId, {
        workspaceId: activeProject!.workspace_id,
      }),
    onSettled: invalidateReadiness,
  });
  const reviewMutation = useMutation({
    mutationFn: (payload: Parameters<typeof searchIntelligenceApi.review>[1]) =>
      searchIntelligenceApi.review(activeProject!.id, payload, {
        workspaceId: activeProject!.workspace_id,
      }),
  });
  const confirmMutation = useMutation({
    mutationFn: (runId: string) =>
      searchIntelligenceApi.confirm(activeProject!.id, runId, {
        workspaceId: activeProject!.workspace_id,
      }),
    onSuccess: async () => {
      setDrawerOpen(false);
      await Promise.all([
        invalidateReadiness(),
        queryClient.invalidateQueries({
          queryKey: searchIntelligenceKeys.runs(activeProject?.workspace_id, activeProject?.id),
        }),
      ]);
    },
  });
  const openReview = (nextAction: string) => {
    setAction(nextAction);
    setDrawerOpen(true);
  };
  const latestDatasets = useMemo(() => {
    const result = new Map<string, SearchIntelligenceDataset>();
    for (const dataset of readiness.data?.datasets ?? []) {
      const key = JSON.stringify([
        dataset.dataset_kind,
        dataset.research_scope ?? 'exact_host',
        dataset.acquisition,
        dataset.target_origin,
        dataset.comparison_origin,
        dataset.location_code,
        dataset.language_code,
      ]);
      if (!result.has(key)) result.set(key, dataset);
    }
    return [...result.values()];
  }, [readiness.data?.datasets]);
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
  const openComparison = (dataset: SearchIntelligenceDataset) => {
    setComparison(dataset);
    setTab('competitors');
  };
  if (readiness.isPending)
    return (
      <PageShell>
        <PageLoading label="Loading Search Intelligence…" />
      </PageShell>
    );
  if (readiness.isError)
    return (
      <PageShell>
        <ReadError
          {...readErrorProps(readiness)}
          fallback="Search Intelligence could not be loaded."
        />
      </PageShell>
    );
  const data = readiness.data;
  const tabs = <TabsBar items={TABS} ariaLabel="Search Intelligence views" variant="band" />;
  if (!data.connected && !data.datasets.length)
    return (
      <TabsRoot value={tab} onValueChange={setTab}>
        <PageShell tabs={tabs}>
          <EmptyState
            icon={Unplug}
            heading="Connect DataForSEO"
            description="Search Intelligence uses your workspace’s own DataForSEO account. Add its login once; every analysis shows its cost before anything is fetched."
            action={<TextLink href={PROVIDER_SETTINGS}>Open provider settings</TextLink>}
          />
        </PageShell>
      </TabsRoot>
    );
  if (!data.owned_targets.length)
    return (
      <TabsRoot value={tab} onValueChange={setTab}>
        <PageShell tabs={tabs}>
          <EmptyState
            icon={Settings2}
            heading="Add your website address"
            description="Search Intelligence researches the project’s own website, so the project needs its homepage address (for example https://www.example.com)."
            action={<TextLink href="/projects">Edit the project</TextLink>}
          />
        </PageShell>
      </TabsRoot>
    );
  const firstRun = <Button onClick={() => openReview('analysis')}>Review first analysis</Button>;
  return (
    <TabsRoot value={tab} onValueChange={setTab}>
      <PageShell
        tabs={tabs}
        actions={
          <PageActions
            hasDatasets={Boolean(data.datasets.length)}
            onReview={openReview}
            onCost={() => setCostOpen(true)}
          />
        }
        controls={
          <ScopeBand
            data={data}
            tab={tab}
            latest={datasets.find((item) =>
              tab === 'backlinks' ? item.location_code === null : item.location_code !== null,
            )}
            marketControl={
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
            }
          />
        }
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
              onDerived={async () => {
                setCitationOpen(false);
                await invalidateReadiness();
              }}
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
            }}
            busy={reviewMutation.isPending || confirmMutation.isPending}
          />
        </Stack>
      </PageShell>
    </TabsRoot>
  );
}

function PageActions({
  hasDatasets,
  onReview,
  onCost,
}: Readonly<{
  hasDatasets: boolean;
  onReview: (action: string) => void;
  onCost: () => void;
}>) {
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onCost}>
        Cost details
      </Button>
      {hasDatasets ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => onReview('analysis')}>
            New analysis
          </Button>
          <Button size="sm" onClick={() => onReview('refresh')}>
            Refresh
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => onReview('analysis')}>
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
      <Button variant="secondary" size="sm" onClick={onSeed}>
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
      <Button variant="secondary" size="sm" onClick={onMatch}>
        Match with Visibility citations
      </Button>
    );
  return null;
}

/** Why saved results cannot be refreshed: no DataForSEO connection. */
function UnavailableNotice({ data }: Readonly<{ data: { connected: boolean } }>) {
  if (data.connected) return null;
  return (
    <Alert>
      DataForSEO is not connected, so saved results can be read but not refreshed.{' '}
      <TextLink href={PROVIDER_SETTINGS}>Open provider settings</TextLink>
    </Alert>
  );
}
