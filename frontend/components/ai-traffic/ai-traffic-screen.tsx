'use client';
import { CRAWL_ONLY_TABS, TRAFFIC_TABS } from '@/lib/config/crawl-logs';
import { useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { crawlLogsAvailable, useCrawlSources } from '@/lib/ai-traffic/use-crawl-connections';
import {
  useOverviewWarmup,
  useTrafficData,
  type TrafficDataTab,
} from '@/lib/ai-traffic/use-traffic-data';
import { ListScreen, RESERVED_CONTROLS } from '@/components/layout/page-shell';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { TabsRoot, TabPanel, type TabRowProps } from '@/components/ui/tabs';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { readErrorProps } from '@/components/ui/read-error';
import { AiReferralsScreen } from './referrals-screen';
import { TrafficControls, TrafficExport } from './traffic-controls';
import { TrafficOverview, TrafficCrawlers, TrafficActivity } from './traffic-views';
import { TrafficPages } from './pages-view';
import { CrawlLogAvailabilityNotice } from './crawl-log-availability';

type TrafficTab = (typeof TRAFFIC_TABS)[number]['value'];
/** Absent or unknown means "not chosen", so the default can follow crawl availability. */
const tabCodec: UrlCodec<TrafficTab | null> = {
  parse: (raw) => TRAFFIC_TABS.find((t) => t.value === raw)?.value ?? null,
  serialize: (value) => value,
};
/**
 * Without crawl log collection the screen leads with Referrals and drops the
 * crawl-only views instead of offering a setup the workspace cannot complete.
 */
function resolveTab(requested: TrafficTab | null, crawlAvailable: boolean | null) {
  if (crawlAvailable === false)
    return requested && !CRAWL_ONLY_TABS.has(requested) ? requested : 'referrals';
  return requested ?? (crawlAvailable === null ? null : 'overview');
}
/**
 * Whether Overview is, or will be, the tab on screen. It is the default while
 * availability is still being read, so its reads need not wait for that answer.
 */
function leadsWithOverview(requested: TrafficTab | null, crawlAvailable: boolean | null) {
  return (requested === null || requested === 'overview') && crawlAvailable !== false;
}
export function AiTrafficScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const sources = useCrawlSources(projectId, workspaceId);
  const [requested, setTab] = useUrlState('tab', tabCodec);
  // Unknown while the sources read is pending; a failed read keeps every view.
  let crawlAvailable: boolean | null = null;
  if (sources.data) crawlAvailable = crawlLogsAvailable(sources.data);
  else if (sources.isError) crawlAvailable = true;
  const tab = resolveTab(requested, crawlAvailable);
  useOverviewWarmup(leadsWithOverview(requested, crawlAvailable));
  const tabs: TabRowProps = {
    ariaLabel: 'AI Traffic views',
    items: crawlAvailable === false ? TRAFFIC_TABS.filter((t) => !t.crawlOnly) : TRAFFIC_TABS,
  };
  // The default view waits for crawl availability. The wait still draws the
  // tab row (nothing selected yet) and the control band, so the loaded view's
  // bands do not push its work down when they arrive.
  if (tab === null)
    return (
      <TabsRoot<TrafficTab | ''>
        value=""
        onValueChange={(next) => {
          if (next) setTab(next);
        }}
      >
        <ListScreen tabs={tabs} controls={RESERVED_CONTROLS}>
          <QueryState kind="loading" label="Loading AI Traffic…" />
        </ListScreen>
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
  const { summary } = model;
  const controls = { filters: <TrafficControls model={model} crawlAvailable={crawlAvailable} /> };
  // Export is a route action, so the control band keeps one short row on every tab.
  const actions = tab === 'overview' ? undefined : <TrafficExport model={model} />;
  // First load keeps the identity, tab and control bands; only the work waits.
  // The table tabs draw their own loading, error and empty states inside the
  // table, in the footprint of a page of rows.
  if (tab === 'overview' && summary.isLoading)
    return (
      <ListScreen tabs={tabs} actions={actions} controls={controls}>
        <QueryState kind="loading" label="Loading AI Traffic…" />
      </ListScreen>
    );
  // A failed read with nothing to show is the region's state, in the same
  // footprint its loading state took.
  if (tab === 'overview' && summary.isError)
    return (
      <ListScreen tabs={tabs} actions={actions} controls={controls}>
        <QueryState
          kind="error"
          {...readErrorProps(summary)}
          fallback="Could not read AI Traffic"
        />
      </ListScreen>
    );
  return (
    <ListScreen tabs={tabs} actions={actions} controls={controls}>
      <TrafficTabContent tab={tab} model={model} crawlAvailable={crawlAvailable} />
    </ListScreen>
  );
}

function TrafficTabContent({
  tab,
  model,
  crawlAvailable,
}: Readonly<{
  tab: TrafficDataTab;
  model: ReturnType<typeof useTrafficData>;
  crawlAvailable: boolean;
}>) {
  const { projectId, workspaceId, summary, filters } = model;
  const scope = { workspaceId, projectId, filters };
  return (
    <Stack gap="workspace">
      <TrafficStatus model={model} />
      {tab === 'overview' && summary.data ? (
        <TrafficOverview
          data={summary.data}
          projectId={projectId}
          workspaceId={workspaceId}
          range={model.selection.range}
          crawlAvailable={crawlAvailable}
        />
      ) : null}
      {tab === 'crawlers' ? <TrafficCrawlers {...scope} /> : null}
      {tab === 'activity' ? <TrafficActivity {...scope} /> : null}
      {tab === 'pages' ? (
        <TabPanel value="pages">
          <TrafficPages {...scope} />
        </TabPanel>
      ) : null}
    </Stack>
  );
}
function TrafficStatus({ model }: Readonly<{ model: ReturnType<typeof useTrafficData> }>) {
  const { exporting } = model;
  return exporting.isError ? (
    <MutationNotice
      notice={mutationNoticeForError(exporting.error, { action: 'export AI traffic' })}
      onRetry={() => exporting.mutate()}
    />
  ) : null;
}
