'use client';
import { CRAWL_ONLY_TABS, TRAFFIC_TABS } from '@/lib/config/crawl-logs';
import { useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { useProjectContext } from '@/lib/project/project-context';
import { crawlLogsAvailable, useCrawlSources } from '@/lib/ai-traffic/use-crawl-connections';
import { useTrafficData, type TrafficDataTab } from '@/lib/ai-traffic/use-traffic-data';
import { PageShell } from '@/components/layout/page-shell';
import { PageLoading } from '@/components/layout/page-loading';
import { Stack } from '@/components/ui/layout';
import { TabsRoot, TabsBar, TabPanel } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
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
  const tabs = (
    <TabsBar
      variant="band"
      ariaLabel="AI Traffic views"
      items={crawlAvailable === false ? TRAFFIC_TABS.filter((t) => !t.crawlOnly) : TRAFFIC_TABS}
    />
  );
  // The default view waits for crawl availability; the tab band needs a selected tab.
  if (tab === null)
    return (
      <PageShell>
        <PageLoading label="Loading AI Traffic…" />
      </PageShell>
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
}: Readonly<{ tab: TrafficDataTab; tabs: React.ReactNode; crawlAvailable: boolean }>) {
  const model = useTrafficData(tab);
  const { projectId, workspaceId, summary, crawlers, activity, catalog, pager, next } = model;
  const controls = <TrafficControls model={model} crawlAvailable={crawlAvailable} />;
  // First load keeps the identity, tab and control bands; only the work waits.
  if (model.isLoading || model.current.isLoading)
    return (
      <PageShell tabs={tabs} controls={controls}>
        <PageLoading label="Loading AI Traffic…" />
      </PageShell>
    );
  return (
    <PageShell tabs={tabs} controls={controls}>
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
                model.selection.verification === 'default'
                  ? undefined
                  : model.selection.verification,
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
    </PageShell>
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
  const { current, projectId, exporting } = model;
  return (
    <>
      {projectId ? null : <ProjectRequiredState />}
      {current.isError ? (
        <ReadError {...readErrorProps(current)} fallback="Could not read AI Traffic" />
      ) : null}
      {exporting.isError ? <Alert tone="danger">{exporting.error.message}</Alert> : null}
    </>
  );
}
