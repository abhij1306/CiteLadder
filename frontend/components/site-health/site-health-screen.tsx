import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { TabsRoot } from '@/components/ui/tabs';
import { ListScreen, RESERVED_CONTROLS } from '@/components/layout/page-shell';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Inline, Stack } from '@/components/ui/layout';
import { SiteHealthDashboardLayout } from '@/components/site-health/dashboard-layout';
import { PAGES_INVENTORY_URL_KEYS } from '@/components/site-health/inventory-section';
import { AeoReadinessPanel } from '@/components/site-health/aeo-readiness-panel';
import { ArchitecturePanel } from '@/components/site-health/architecture-panel';
import { ChangesPanel } from '@/components/site-health/changes-panel';
import { useCrawlSchedule } from '@/components/site-health/crawl-schedule-control';
import { InternalLinksPanel } from '@/components/site-health/internal-links-panel';
import {
  useInternalLinksBands,
  type LinksRead,
} from '@/components/site-health/internal-links-panel-bands';
import { OverviewPanel } from '@/components/site-health/overview-panel';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { httpErrorStatus } from '@/lib/api/errors';
import { warmQuery } from '@/lib/api/query-client';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { internalLinksQueries } from '@/lib/api/site-health-internal-links';
import type { CrawlRobotsHandling, SiteCrawl } from '@citeladder/contracts';
import { StartCrawlControl } from '@/components/site-health/robots-choice';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { useSiteHealthScreen } from '@/lib/site-health/use-site-health-screen';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

export function SiteHealthScreen() {
  const { workspaceId, projectId } = useProjectScope();
  return <SiteHealthContent projectId={projectId} workspaceId={workspaceId} />;
}

function SiteHealthContent({
  projectId,
  workspaceId,
}: Readonly<{
  projectId: string;
  workspaceId: string;
}>) {
  const screen = useSiteHealthScreen();
  const { crawl, active, startPending, cancelMutation, startCrawl, cancelCrawl } = screen;
  const [tab, selectTab] = useUrlState('tab', TAB_CODEC, {
    clearKeys: ['cursor', 'sort', ...PAGES_INVENTORY_URL_KEYS],
  });
  const blocking = projectBlockingState(screen);
  // Crawl controls are offered only to a role that may run crawls; the
  // schedule, a saved setting, only to one that may write.
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const schedule = useCrawlSchedule(
    { workspaceId, projectId },
    Boolean(crawl) && canWrite,
    crawl?.robots,
  );
  // Internal links' search, filters and header actions act on the analysis its panel draws.
  const links = useInternalLinksBands({
    scope: { projectId, workspaceId },
    enabled: tab === 'internal-links' && !blocking,
  });
  const linksActions = tab === 'internal-links' ? links.actions : null;
  const controls = tabControls({ tab, blocking, links: links.controls });
  const refreshFailures = !blocking ? <SiteHealthRefreshFailures screen={screen} /> : null;
  // Each export sits at the end of the row of the list it exports: the pages
  // table's toolbar, Internal links' control row. The header keeps the crawl
  // controls and a tab's primary action.
  const headerActions =
    crawl && canRun ? (
      <CrawlActions
        crawl={crawl}
        active={active}
        cancelPending={cancelMutation.isPending}
        startPending={startPending}
        tabActions={linksActions}
        schedule={schedule.control}
        onCancel={cancelCrawl}
        onStart={(robots) => startCrawl({ project_id: projectId, robots })}
      />
    ) : (
      (linksActions ?? undefined)
    );
  const prefetchTab = useSiteHealthTabPrefetch(workspaceId, projectId, crawl?.id, !active);
  if (blocking?.kind === 'state') {
    return (
      <ListScreen>
        <Stack gap="workspace" className="min-w-0">
          {blocking.node}
        </Stack>
      </ListScreen>
    );
  }
  // The first load draws the loaded page's bands — the tab row included — with
  // one loading box where the panel will be, so the work arrives without the
  // tabs pushing it down a band.
  return (
    <TabsRoot value={tab} onValueChange={selectTab}>
      <ListScreen
        actions={headerActions}
        tabs={{ items: ANALYSIS_TABS, ariaLabel: 'Website analysis', onIntent: prefetchTab }}
        controls={controls}
      >
        {blocking ? (
          <QueryState kind="loading" label={blocking.label} />
        ) : (
          <Stack gap="workspace" className="min-w-0">
            <SiteHealthNotices screen={screen} />
            {schedule.notice}
            {refreshFailures}
            <AnalysisPanel
              tab={tab}
              crawlId={crawl?.id}
              projectId={projectId}
              workspaceId={workspaceId}
              screen={screen}
              linksRead={links.read}
            />
          </Stack>
        )}
      </ListScreen>
    </TabsRoot>
  );
}

/**
 * The selected tab's control row: Internal links alone has one (Pages' view,
 * filter and export scope its table, so they lead that table's toolbar). It
 * holds the row through the first load, so its work starts on the same line
 * once it lands.
 */
function tabControls({
  tab,
  blocking,
  links,
}: Readonly<{
  tab: AnalysisTab;
  blocking: BlockingState | null;
  links: FilterBarProps | undefined;
}>): FilterBarProps | undefined {
  if (tab !== 'internal-links') return undefined;
  if (blocking?.kind === 'loading') return RESERVED_CONTROLS;
  if (blocking) return undefined;
  return links;
}

/** What stands in for the analysis: the one first-load wait, or a state that replaces the page. */
type BlockingState =
  | Readonly<{ kind: 'loading'; label: string }>
  | Readonly<{ kind: 'state'; node: ReactNode }>;

function projectBlockingState(
  screen: ReturnType<typeof useSiteHealthScreen>,
): BlockingState | null {
  return screenBlockingState({ dashboard: screen.dashboardQuery, phase: screen.phase });
}

function isAccessFailure(error: unknown): boolean {
  const status = httpErrorStatus(error);
  return status === 401 || status === 403;
}

function SiteHealthRefreshFailures({
  screen,
}: Readonly<{ screen: ReturnType<typeof useSiteHealthScreen> }>) {
  return (
    <>
      {screen.dashboardQuery.isError && screen.dashboardQuery.data ? (
        <ReadError
          error={screen.dashboardQuery.error}
          fallback="Could not refresh Site Health."
          onRetry={() => void screen.dashboardQuery.refetch()}
          pending={screen.dashboardQuery.isFetching}
        />
      ) : null}
    </>
  );
}

/**
 * Warm the tab the pointer is heading for.
 *
 * `terminal` gates the Overview alone, because the Overview snapshot does not
 * EXIST until the crawl terminalizes — warming it mid-crawl fetched a 404 into
 * the very cache entry the panel reads, and React Query keeps an error once it
 * has one. Hovering a tab is not a request to report a failure. Every other
 * projection here answers with its own "not available yet" payload instead of
 * an error, so those stay warm at any point in the run.
 */
function useSiteHealthTabPrefetch(
  workspaceId: string,
  projectId: string,
  crawlId: string | undefined,
  terminal: boolean,
) {
  const queryClient = useQueryClient();
  return (nextTab: AnalysisTab) => {
    const scope = { workspaceId, projectId };
    if (nextTab === 'overview') {
      if (terminal) warmQuery(queryClient, siteHealthQueries.overview(scope, crawlId));
    } else if (nextTab === 'architecture') {
      warmQuery(queryClient, siteHealthQueries.architecture(scope, crawlId));
    } else if (nextTab === 'aeo-readiness') {
      warmQuery(queryClient, siteHealthQueries.aeoReadiness(scope, crawlId));
    } else if (nextTab === 'internal-links') {
      warmQuery(queryClient, internalLinksQueries.analysis(scope));
    } else if (nextTab === 'changes') {
      warmQuery(queryClient, siteHealthQueries.changesSummary(scope));
    }
  };
}

function SiteHealthNotices({
  screen,
}: Readonly<{ screen: ReturnType<typeof useSiteHealthScreen> }>) {
  return (
    <>
      {screen.exportError ? <Callout tone="negative">{screen.exportError}</Callout> : null}
      {screen.createMutation.isError ? (
        <MutationNotice
          notice={mutationNoticeForError(screen.createMutation.error, {
            action: 'start a crawl',
          })}
          onRetry={screen.retryStart}
        />
      ) : null}
      {screen.cancelMutation.isError ? (
        <MutationNotice
          notice={mutationNoticeForError(screen.cancelMutation.error, {
            action: 'stop the crawl',
          })}
          onRetry={screen.cancelCrawl}
        />
      ) : null}
      {screen.stalled ? (
        <Callout tone="warning">
          This crawl stopped making progress. It resumes automatically if it can; results so far are
          shown below.
        </Callout>
      ) : null}
    </>
  );
}

type AnalysisTab =
  | 'overview'
  | 'pages'
  | 'architecture'
  | 'aeo-readiness'
  | 'internal-links'
  | 'changes';

const ANALYSIS_TABS: ReadonlyArray<{ value: AnalysisTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'pages', label: 'Pages' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'aeo-readiness', label: 'AEO Readiness' },
  { value: 'internal-links', label: 'Internal links' },
  { value: 'changes', label: 'Changes' },
];

/**
 * Site Health always opens on Pages and never changes tab by itself: not
 * while the crawl resolves, starts, runs or finishes (owner, 2026-11-02). A
 * tab the reader picks, or a `?tab=` link, stays as chosen.
 */
const TAB_CODEC = stringUrlCodec<AnalysisTab>(
  ANALYSIS_TABS.map((item) => item.value),
  'pages',
);

function AnalysisPanel({
  tab,
  crawlId,
  projectId,
  workspaceId,
  screen,
  linksRead,
}: Readonly<{
  tab: string;
  crawlId: string | undefined;
  projectId: string;
  workspaceId: string;
  screen: ReturnType<typeof useSiteHealthScreen>;
  linksRead: LinksRead;
}>) {
  if (tab === 'pages') return <SiteHealthDashboardLayout screen={screen} />;
  if (tab === 'overview' && crawlId)
    return (
      <OverviewPanel
        projectId={projectId}
        workspaceId={workspaceId}
        crawlId={crawlId}
        crawl={screen.crawl}
        dashboard={screen.dashboardQuery.data}
      />
    );
  // Architecture reads a project-scoped projection, so it renders its own
  // "derived after the crawl finishes" state rather than needing a crawl here.
  if (tab === 'architecture')
    return <ArchitecturePanel projectId={projectId} workspaceId={workspaceId} crawlId={crawlId} />;
  if (tab === 'aeo-readiness' && crawlId)
    return <AeoReadinessPanel projectId={projectId} workspaceId={workspaceId} crawlId={crawlId} />;
  if (tab === 'internal-links')
    return <InternalLinksPanel read={linksRead} workspaceId={workspaceId} />;
  if (tab === 'changes') return <ChangesPanel projectId={projectId} workspaceId={workspaceId} />;
  return <Callout tone="info">Run a crawl before opening Website analysis.</Callout>;
}

function screenBlockingState({
  dashboard,
  phase,
}: Readonly<{
  dashboard: ReturnType<typeof useSiteHealthScreen>['dashboardQuery'];
  phase: string;
}>): BlockingState | null {
  if (dashboard.isError && (!dashboard.data || isAccessFailure(dashboard.error)))
    return {
      kind: 'state',
      node: (
        <QueryState
          kind="error"
          error={dashboard.error}
          fallback="Could not load Site Health."
          onRetry={() => void dashboard.refetch()}
          pending={dashboard.isFetching}
        />
      ),
    };
  if (dashboard.isLoading || phase === 'resolving')
    return { kind: 'loading', label: 'Loading your latest Site Health crawl…' };
  return null;
}

function CrawlActions({
  crawl,
  active,
  cancelPending,
  startPending,
  tabActions,
  schedule,
  onCancel,
  onStart,
}: Readonly<{
  /** The shown crawl: its site and robots choice, which the next crawl keeps. */
  crawl: Pick<SiteCrawl, 'root_url' | 'robots'>;
  active: boolean;
  cancelPending: boolean;
  startPending: boolean;
  /**
   * A tab's own primary action (Internal links' Analyze again). Run new
   * crawl then steps down to secondary, so the header keeps one primary
   * button.
   */
  tabActions: ReactNode;
  /** The crawl schedule, beside the crawl button. */
  schedule: ReactNode;
  onCancel: () => void;
  onStart: (robots?: CrawlRobotsHandling) => void;
}>) {
  return (
    <Inline>
      {schedule}
      {active ? (
        <Button variant="danger" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Stopping…' : 'Stop crawl'}
        </Button>
      ) : (
        <StartCrawlControl
          siteUrl={crawl.root_url}
          robots={crawl.robots}
          primary={!tabActions}
          pending={startPending}
          onStart={onStart}
        />
      )}
      {tabActions}
    </Inline>
  );
}
