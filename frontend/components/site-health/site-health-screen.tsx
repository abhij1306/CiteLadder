'use client';

import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { TabsRoot } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { ListScreen } from '@/components/layout/page-shell';
import { Inline, Stack } from '@/components/ui/layout';
import { SiteHealthDashboardLayout } from '@/components/site-health/dashboard-layout';
import { AeoReadinessPanel } from '@/components/site-health/aeo-readiness-panel';
import { ArchitecturePanel } from '@/components/site-health/architecture-panel';
import { ChangesPanel } from '@/components/site-health/changes-panel';
import { InternalLinksPanel } from '@/components/site-health/internal-links-panel';
import { OverviewPanel } from '@/components/site-health/overview-panel';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { httpErrorStatus } from '@/lib/api/errors';
import { warmQuery } from '@/lib/api/query-client';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import { internalLinksQueries } from '@/lib/api/site-health-internal-links';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useSiteHealthScreen } from '@/lib/site-health/use-site-health-screen';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

export function SiteHealthScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const screen = useSiteHealthScreen();
  return <SiteHealthContent projectId={projectId} workspaceId={workspaceId} screen={screen} />;
}

function SiteHealthContent({
  projectId,
  workspaceId,
  screen,
}: Readonly<{
  projectId: string;
  workspaceId: string;
  screen: ReturnType<typeof useSiteHealthScreen>;
}>) {
  const {
    crawl,
    active,
    startPending,
    cancelMutation,
    startCrawl,
    recrawl,
    cancelCrawl,
    runExport,
    exporting,
  } = screen;
  const [tab, selectTab] = useUrlState('tab', TAB_CODEC, {
    clearKeys: ['cursor', 'sort'],
  });
  const blocking = projectBlockingState(screen);
  const refreshFailures = !blocking ? <SiteHealthRefreshFailures screen={screen} /> : null;
  const headerActions = crawl ? (
    <CrawlActions
      active={active}
      exporting={exporting}
      cancelPending={cancelMutation.isPending}
      startPending={startPending}
      onExport={() => runExport('csv', 'pages')}
      onCancel={cancelCrawl}
      onStart={startCrawl}
      onRecrawl={recrawl}
    />
  ) : undefined;
  const prefetchTab = useSiteHealthTabPrefetch(workspaceId, projectId, crawl?.id, !active);
  if (blocking?.kind === 'state') {
    return (
      <ListScreen>
        <Stack gap="section" className="min-w-0">
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
      >
        {blocking ? (
          <QueryState kind="loading" label={blocking.label} />
        ) : (
          <Stack gap="section" className="min-w-0">
            <SiteHealthNotices screen={screen} />
            {refreshFailures}
            <AnalysisPanel
              tab={tab}
              crawlId={crawl?.id}
              projectId={projectId}
              workspaceId={workspaceId}
              screen={screen}
            />
          </Stack>
        )}
      </ListScreen>
    </TabsRoot>
  );
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
          onRetry={screen.startCrawl}
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
}: Readonly<{
  tab: string;
  crawlId: string | undefined;
  projectId: string;
  workspaceId: string;
  screen: ReturnType<typeof useSiteHealthScreen>;
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
    return (
      <ArchitecturePanel
        key={projectId}
        projectId={projectId}
        workspaceId={workspaceId}
        crawlId={crawlId}
      />
    );
  if (tab === 'aeo-readiness' && crawlId)
    return <AeoReadinessPanel projectId={projectId} workspaceId={workspaceId} crawlId={crawlId} />;
  if (tab === 'internal-links')
    return <InternalLinksPanel key={projectId} projectId={projectId} workspaceId={workspaceId} />;
  if (tab === 'changes')
    return <ChangesPanel key={projectId} projectId={projectId} workspaceId={workspaceId} />;
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
  active,
  exporting,
  cancelPending,
  startPending,
  onExport,
  onCancel,
  onStart,
  onRecrawl,
}: Readonly<{
  active: boolean;
  exporting: boolean;
  cancelPending: boolean;
  startPending: boolean;
  onExport: () => void;
  onCancel: () => void;
  onStart: () => void;
  onRecrawl: () => void;
}>) {
  return (
    <Inline>
      <Button variant="secondary" onClick={onExport} disabled={exporting}>
        {exporting ? 'Exporting…' : 'Export'}
      </Button>
      {/* Always present, so starting a crawl never reflows the header. */}
      <Tooltip content="Rerun this crawl's scope and settings, so Changes compares like with like.">
        <Button variant="secondary" onClick={onRecrawl} disabled={active || startPending}>
          Recrawl
        </Button>
      </Tooltip>
      {active ? (
        <Button variant="danger" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Stopping…' : 'Stop crawl'}
        </Button>
      ) : (
        <Button variant="primary" onClick={() => onStart()} disabled={startPending}>
          {startPending ? 'Starting…' : 'Run new crawl'}
        </Button>
      )}
    </Inline>
  );
}
