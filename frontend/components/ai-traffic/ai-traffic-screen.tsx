import { CRAWL_ONLY_TABS, TRAFFIC_TABS } from '@/lib/ai-traffic/tabs';
import { useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { crawlLogsAvailable, useCrawlSources } from '@/lib/ai-traffic/use-crawl-connections';
import {
  useOverviewWarmup,
  useTrafficData,
  type TrafficDataTab,
} from '@/lib/ai-traffic/use-traffic-data';
import { ReportPage } from '@/components/templates/report-page';
import { FilterBar } from '@/components/ui/filter-bar';
import { TabsRoot, TabPanel, TabRow, type TabRowProps } from '@/components/ui/tabs';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { AiReferralsScreen } from './referrals-screen';
import { clearTrafficFilters, TrafficExport, trafficFilters } from './traffic-controls';
import { TrafficOverview, TrafficCrawlers, TrafficActivity } from './traffic-views';
import { overviewStarted } from './overview-signals';
import { TrafficSetupState } from './traffic-setup';
import { useSourceStep, type SourceStep } from '@/components/integrations/data-sources';
import { Stack } from '@/components/ui/layout';
import { TrafficPages } from './pages-view';
import { CrawlLogAvailabilityNotice } from './crawl-log-availability';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type TrafficTab = (typeof TRAFFIC_TABS)[number]['value'];
const tabCodec: UrlCodec<TrafficTab | null> = {
  parse: (raw) => TRAFFIC_TABS.find((t) => t.value === raw)?.value ?? null,
  serialize: (value) => value,
};
function resolveTab(requested: TrafficTab | null, crawlAvailable: boolean | null) {
  if (crawlAvailable === false)
    return requested && !CRAWL_ONLY_TABS.has(requested) ? requested : 'referrals';
  return requested ?? (crawlAvailable === null ? null : 'overview');
}
function leadsWithOverview(requested: TrafficTab | null, crawlAvailable: boolean | null) {
  return (requested === null || requested === 'overview') && crawlAvailable !== false;
}
export function AiTrafficScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const sources = useCrawlSources(projectId, workspaceId);
  const [requested, setTab] = useUrlState('tab', tabCodec);
  let crawlAvailable: boolean | null = null;
  if (sources.data) crawlAvailable = crawlLogsAvailable(sources.data);
  else if (sources.isError || sources.errorUpdatedAt > 0) crawlAvailable = true;
  const tab = resolveTab(requested, crawlAvailable);
  useOverviewWarmup(leadsWithOverview(requested, crawlAvailable));
  const tabs: TabRowProps = {
    ariaLabel: 'AI traffic views',
    items: crawlAvailable === false ? TRAFFIC_TABS.filter((t) => !t.crawlOnly) : TRAFFIC_TABS,
  };
  if (tab === null)
    return (
      <TabsRoot<TrafficTab | ''>
        value=""
        onValueChange={(next) => {
          if (next) setTab(next);
        }}
      >
        <ReportPage tabs={<TabRow {...tabs} />}>
          <StateBlock kind="loading" label="Loading AI traffic…" shape={{ kind: 'figures' }} />
        </ReportPage>
      </TabsRoot>
    );
  return (
    <TabsRoot value={tab} onValueChange={setTab}>
      {tab === 'referrals' ? (
        <AiReferralsScreen
          tabs={tabs}
          notice={
            crawlAvailable === false && sources.data ? (
              <CrawlLogAvailabilityNotice availability={sources.data.availability} />
            ) : undefined
          }
        />
      ) : (
        <TrafficDataView tab={tab} tabs={tabs} crawlAvailable={crawlAvailable !== false} />
      )}
    </TabsRoot>
  );
}
function TrafficDataView({
  tab,
  tabs,
  crawlAvailable,
}: Readonly<{ tab: TrafficDataTab; tabs: TabRowProps; crawlAvailable: boolean }>) {
  const model = useTrafficData(tab);
  const { summary, workspaceId, projectId } = model;
  const ga4 = useSourceStep(workspaceId, projectId, 'ga4');
  const sources = useCrawlSources(projectId, workspaceId);
  const idle = trafficIdle({ tab, ga4, sources: sources.data, overview: summary.data });
  const frame = {
    tabs: <TabRow {...tabs} />,
    filters: idle ? undefined : (
      <FilterBar
        filters={trafficFilters({ model, crawlAvailable })}
        actions={tab === 'overview' ? undefined : <TrafficExport model={model} />}
      />
    ),
  };
  if (idle)
    return (
      <ReportPage {...frame}>
        <TrafficSetupState ga4Missing={ga4?.kind === 'connect'} crawlAvailable={crawlAvailable} />
      </ReportPage>
    );
  if (tab === 'overview' && summary.isLoading)
    return (
      <ReportPage {...frame}>
        <Stack gap="workspace" className="min-w-0">
          <StateBlock kind="loading" label="Loading AI traffic…" shape={{ kind: 'figures' }} />
          <StateBlock kind="loading" label="Loading AI traffic…" shape={{ kind: 'chart' }} />
        </Stack>
      </ReportPage>
    );
  if (tab === 'overview' && summary.isError)
    return (
      <ReportPage {...frame}>
        <StateBlock
          kind="error"
          {...readErrorProps(summary)}
          title="Couldn't load AI traffic"
          fallback="The request failed or timed out."
        />
      </ReportPage>
    );
  return (
    <ReportPage {...frame}>
      <TrafficTabContent tab={tab} model={model} crawlAvailable={crawlAvailable} ga4={ga4} />
    </ReportPage>
  );
}

function trafficIdle({
  tab,
  ga4,
  sources,
  overview,
}: Readonly<{
  tab: TrafficDataTab;
  ga4: SourceStep | null;
  sources: Readonly<{ items: readonly unknown[] }> | undefined;
  overview: ReturnType<typeof useTrafficData>['summary']['data'];
}>): boolean {
  switch (tab) {
    case 'overview':
      return ga4?.kind === 'connect' && overview !== undefined && !overviewStarted(overview);
    case 'crawlers':
    case 'activity':
      return sources?.items.length === 0;
    case 'pages':
      return false;
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}

function TrafficTabContent({
  tab,
  model,
  crawlAvailable,
  ga4,
}: Readonly<{
  tab: TrafficDataTab;
  model: ReturnType<typeof useTrafficData>;
  crawlAvailable: boolean;
  ga4: SourceStep | null;
}>) {
  const { projectId, workspaceId, summary, filters } = model;
  const scope = { workspaceId, projectId, filters };
  const crawlScope = { ...scope, onClearFilters: () => clearTrafficFilters(model) };
  return (
    <>
      <TrafficStatus model={model} />
      {tab === 'overview' && summary.data ? (
        <TrafficOverview
          data={summary.data}
          projectId={projectId}
          workspaceId={workspaceId}
          range={model.selection.range}
          crawlAvailable={crawlAvailable}
          ga4={ga4}
        />
      ) : null}
      {tab === 'crawlers' ? <TrafficCrawlers {...crawlScope} /> : null}
      {tab === 'activity' ? <TrafficActivity {...crawlScope} /> : null}
      {tab === 'pages' ? (
        <TabPanel value="pages">
          <TrafficPages {...scope} sort={model.selection.sort} onSort={model.selection.setSort} />
        </TabPanel>
      ) : null}
    </>
  );
}
function TrafficStatus({ model }: Readonly<{ model: ReturnType<typeof useTrafficData> }>) {
  const { exporting } = model;
  return exporting.isError ? (
    <Notice
      kind="mutation"
      notice={mutationNoticeForError(exporting.error, { action: 'export AI traffic' })}
      onRetry={() => exporting.mutate()}
    />
  ) : null;
}
