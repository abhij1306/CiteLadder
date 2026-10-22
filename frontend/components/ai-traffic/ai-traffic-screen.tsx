'use client';
import { CRAWL_ONLY_TABS, TRAFFIC_TABS } from '@/lib/config/crawl-logs';
import { useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { useProjectContext } from '@/lib/project/project-context';
import { crawlLogsAvailable, useCrawlSources } from '@/lib/ai-traffic/use-crawl-connections';
import { useTrafficData, type TrafficDataTab } from '@/lib/ai-traffic/use-traffic-data';
import { ListScreen } from '@/components/layout/page-shell';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { TabsRoot, TabPanel, type TabRowProps } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { readErrorProps } from '@/components/ui/read-error';
import { AiReferralsScreen } from './referrals-screen';
import { TrafficControls } from './traffic-controls';
import { TrafficOverview, TrafficCrawlers, TrafficActivity } from './traffic-views';
import { Pager } from '@/components/ui/pager';
import { cursorControls } from '@/lib/table/use-cursor-table';
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
export function AiTrafficScreen() {
  const { activeProject } = useProjectContext();
  const sources = useCrawlSources(activeProject?.id ?? '', activeProject?.workspace_id ?? '');
  const [requested, setTab] = useUrlState('tab', tabCodec);
  // Unknown while the sources read is pending; a failed read keeps every view.
  let crawlAvailable: boolean | null = null;
  if (sources.data) crawlAvailable = crawlLogsAvailable(sources.data);
  else if (sources.isError || !activeProject) crawlAvailable = true;
  const tab = resolveTab(requested, crawlAvailable);
  const tabs: TabRowProps = {
    ariaLabel: 'AI Traffic views',
    items: crawlAvailable === false ? TRAFFIC_TABS.filter((t) => !t.crawlOnly) : TRAFFIC_TABS,
  };
  // The default view waits for crawl availability; the tab band needs a selected tab.
  if (tab === null)
    return (
      <ListScreen>
        <QueryState kind="loading" label="Loading AI Traffic…" />
      </ListScreen>
    );
  return (
    <TabsRoot value={tab} onValueChange={setTab}>
      {tab === 'referrals' ? (
        <AiReferralsScreen
          tabs={tabs}
          notice={
            crawlAvailable === false && sources.data && activeProject ? (
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
  const { projectId } = model;
  const controls = { filters: <TrafficControls model={model} crawlAvailable={crawlAvailable} /> };
  // First load keeps the identity, tab and control bands; only the work waits.
  if (model.isLoading || model.current.isLoading)
    return (
      <ListScreen tabs={tabs} controls={controls}>
        <QueryState kind="loading" label="Loading AI Traffic…" />
      </ListScreen>
    );
  // A failed read with nothing to show is the region's state, in the same
  // footprint its loading state took.
  if (model.current.isError && projectId)
    return (
      <ListScreen tabs={tabs} controls={controls}>
        <QueryState
          kind="error"
          {...readErrorProps(model.current)}
          fallback="Could not read AI Traffic"
        />
      </ListScreen>
    );
  return (
    <ListScreen tabs={tabs} controls={controls}>
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
  const { projectId, workspaceId, summary, crawlers, activity, catalog, pager, next } = model;
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
      {tab === 'crawlers' && crawlers.data ? (
        <TrafficCrawlers
          data={crawlers.data}
          filters={{
            range: model.selection.range,
            verification:
              model.selection.verification === 'default' ? undefined : model.selection.verification,
          }}
        />
      ) : null}
      {tab === 'activity' && activity.data ? (
        <TrafficActivity data={activity.data} catalog={catalog.data} />
      ) : null}
      {tab === 'pages' ? <PagesPanel model={model} /> : null}
      {tab === 'overview' ? null : (
        <Pager hideWhenSinglePage page={pager.page} {...cursorControls(pager, next)} />
      )}
    </Stack>
  );
}
function PagesPanel({ model }: Readonly<{ model: ReturnType<typeof useTrafficData> }>) {
  const { pages, selection } = model;
  if (pages.isError || !pages.data) return null;
  return (
    <TabPanel value="pages">
      <TrafficPages
        data={pages.data}
        filters={{
          range: selection.range,
          verification: selection.verification === 'default' ? undefined : selection.verification,
        }}
      />
    </TabPanel>
  );
}
function TrafficStatus({ model }: Readonly<{ model: ReturnType<typeof useTrafficData> }>) {
  const { projectId, exporting } = model;
  return (
    <>
      {projectId ? null : <ProjectRequiredState />}
      {exporting.isError ? <Alert tone="danger">{exporting.error.message}</Alert> : null}
    </>
  );
}
