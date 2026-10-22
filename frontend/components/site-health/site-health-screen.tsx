'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { Button } from '@/components/ui/button';
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
import { siteHealthQueries } from '@/lib/api/site-health';
import { internalLinksQuery } from '@/lib/api/site-health-internal-links';
import { useProjectContext } from '@/lib/project/project-context';
import { useSiteHealthScreen } from '@/lib/site-health/use-site-health-screen';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

export function SiteHealthScreen() {
  const { activeProject, activeWorkspaceId, isLoading } = useProjectContext();
  const projectId = activeProject?.id ?? null;
  const screen = useSiteHealthScreen(projectId);
  return (
    <SiteHealthContent
      projectId={projectId}
      workspaceId={activeWorkspaceId}
      projectLoading={isLoading}
      screen={screen}
    />
  );
}

function SiteHealthContent({
  projectId,
  workspaceId,
  projectLoading,
  screen,
}: Readonly<{
  projectId: string | null;
  workspaceId: string | null;
  projectLoading: boolean;
  screen: ReturnType<typeof useSiteHealthScreen>;
}>) {
  const {
    phase,
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
  const defaultTab: AnalysisTab = phase === 'dashboard' ? 'overview' : 'pages';
  const tabCodec = useMemo(
    () =>
      stringUrlCodec(
        ANALYSIS_TABS.map((item) => item.value),
        defaultTab,
      ),
    [defaultTab],
  );
  const [tab, selectTab] = useUrlState('tab', tabCodec, {
    clearKeys: ['cursor', 'sort'],
  });
  const blockingState = projectBlockingState(projectId, projectLoading, screen);
  const refreshFailures = !blockingState ? <SiteHealthRefreshFailures screen={screen} /> : null;
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
  if (blockingState) {
    return (
      <ListScreen>
        <Stack gap="section" className="min-w-0">
          {refreshFailures}
          {blockingState}
        </Stack>
      </ListScreen>
    );
  }
  return (
    <TabsRoot value={tab as AnalysisTab} onValueChange={selectTab}>
      <ListScreen
        actions={headerActions}
        tabs={{ items: ANALYSIS_TABS, ariaLabel: 'Website analysis', onIntent: prefetchTab }}
      >
        <Stack gap="section" className="min-w-0">
          <SiteHealthNotices screen={screen} />
          {refreshFailures}
          <AnalysisPanel
            tab={tab}
            crawlId={crawl?.id}
            projectId={projectId!}
            workspaceId={workspaceId!}
            screen={screen}
          />
        </Stack>
      </ListScreen>
    </TabsRoot>
  );
}

function projectBlockingState(
  projectId: string | null,
  projectLoading: boolean,
  screen: ReturnType<typeof useSiteHealthScreen>,
) {
  if (projectLoading)
    return <QueryState kind="loading" label="Loading your Site Health project…" />;
  if (!projectId) return <ProjectRequiredState />;
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
  workspaceId: string | null,
  projectId: string | null,
  crawlId: string | undefined,
  terminal: boolean,
) {
  const queryClient = useQueryClient();
  return (nextTab: AnalysisTab) => {
    if (!projectId || !workspaceId) return;
    if (nextTab === 'overview') {
      if (terminal)
        warmQuery(queryClient, siteHealthQueries.overview(workspaceId, projectId, crawlId));
    } else if (nextTab === 'architecture') {
      warmQuery(queryClient, siteHealthQueries.architecture(workspaceId, projectId, crawlId));
    } else if (nextTab === 'aeo-readiness') {
      warmQuery(queryClient, siteHealthQueries.aeoReadiness(workspaceId, projectId, crawlId));
    } else if (nextTab === 'internal-links') {
      warmQuery(queryClient, internalLinksQuery(workspaceId, projectId));
    } else if (nextTab === 'changes') {
      warmQuery(queryClient, siteHealthQueries.changesSummary(workspaceId, projectId));
    }
  };
}

function SiteHealthNotices({
  screen,
}: Readonly<{ screen: ReturnType<typeof useSiteHealthScreen> }>) {
  return (
    <>
      {screen.exportError ? <Alert tone="danger">{screen.exportError}</Alert> : null}
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
        <Alert tone="warning">
          This crawl stopped making progress. It resumes automatically if it can; results so far are
          shown below.
        </Alert>
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
  return <Alert tone="info">Run a crawl before opening Website analysis.</Alert>;
}

function screenBlockingState({
  dashboard,
  phase,
}: Readonly<{
  dashboard: ReturnType<typeof useSiteHealthScreen>['dashboardQuery'];
  phase: string;
}>) {
  if (dashboard.isError && (!dashboard.data || isAccessFailure(dashboard.error)))
    return (
      <QueryState
        kind="error"
        error={dashboard.error}
        fallback="Could not load Site Health."
        onRetry={() => void dashboard.refetch()}
        pending={dashboard.isFetching}
      />
    );
  if (dashboard.isLoading || phase === 'resolving')
    return <QueryState kind="loading" label="Loading your latest Site Health crawl…" />;
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
        <Button variant="destructive" onClick={onCancel} disabled={cancelPending}>
          {cancelPending ? 'Stopping…' : 'Stop crawl'}
        </Button>
      ) : (
        <Button onClick={() => onStart()} disabled={startPending}>
          {startPending ? 'Starting…' : 'Run new crawl'}
        </Button>
      )}
    </Inline>
  );
}
