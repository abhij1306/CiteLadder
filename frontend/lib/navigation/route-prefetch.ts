import type { QueryClient } from '@tanstack/react-query';

import { readFromIntent, warmQuery } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { findAppRoute, type AppRoutePath } from '@/lib/navigation/app-routes';
import { preloadRouteChunk } from '@/lib/navigation/route-chunks';

export type ProjectScope = { projectId: string; workspaceId: string };
type RoutePrefetcher = (client: QueryClient, scope: ProjectScope) => Promise<void>;

/**
 * Primary read intent for data-heavy application destinations. Query keys are
 * identical to each screen's default request, so pointer and keyboard intent
 * warm the existing domain cache rather than creating a navigation cache.
 *
 * **Every prefetcher imports its API module dynamically, and that is load-bearing.**
 * This map reaches a dozen domains. `sidebar-nav` imports it, `app-shell` imports
 * that, and the router imports the shell — so a static import here placed every
 * domain's client, and the Zod schema module behind each one, in the chunk the
 * browser must download before it can render anything at all. The whole point
 * of the map is that none of those reads have happened yet.
 *
 * The extra microtask before the request is free: nothing awaits a prefetch,
 * and the chunk is already warm by the second hover.
 */
const ROUTE_PREFETCHERS: Readonly<Partial<Record<AppRoutePath, RoutePrefetcher>>> = {
  '/projects': prefetchOverview,
  '/site': prefetchSiteHealth,
  '/issues': prefetchIssues,
  '/demand': async (client, { projectId, workspaceId }) => {
    const { latestDemandSnapshotQuery } = await import('@/lib/demand/latest-snapshot');
    warmQuery(client, latestDemandSnapshotQuery(projectId, workspaceId));
  },
  '/performance': async (client, { projectId, workspaceId }) => {
    // The landing view, built from the screen's own defaults: the latest
    // persisted snapshot, daily buckets, no comparison.
    const [{ performanceQueries }, { INITIAL_DASHBOARD_PARAMS }] = await Promise.all([
      import('@/lib/api/performance'),
      import('@/lib/performance/performance'),
    ]);
    warmQuery(
      client,
      performanceQueries.dashboard(workspaceId, projectId, INITIAL_DASHBOARD_PARAMS),
    );
  },
  '/search-intelligence': async (client, { projectId, workspaceId }) => {
    // Readiness gates the whole screen: nothing below the tabs draws without it.
    const { searchIntelligenceQueries } = await import('@/lib/api/search-intelligence');
    warmQuery(client, searchIntelligenceQueries.readiness(workspaceId, projectId));
  },
  '/products': async (client, { projectId, workspaceId }) => {
    const { commerceApi } = await import('@/lib/api/commerce');
    // The screen always loads the catalog (its navigation), the competitors
    // and the buyer prompts; the shelf waits for a selected target.
    warmQuery(client, {
      queryKey: queryKeys.commerce.catalog(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        commerceApi.catalog(projectId, { signal, workspaceId }),
    });
    warmQuery(client, {
      queryKey: queryKeys.commerce.competitors(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        commerceApi.competitors(projectId, { signal, workspaceId }),
    });
    warmQuery(client, {
      queryKey: queryKeys.commerce.buyerPrompts(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        commerceApi.buyerPrompts(projectId, { signal, workspaceId }),
    });
  },
  // New chat: its recommended Actions are the screen's one project read.
  '/agent': async (client, { projectId, workspaceId }) => {
    const { actionsQueries } = await import('@/lib/api/actions');
    warmQuery(client, actionsQueries.list(workspaceId, projectId));
  },
  '/agent/actions': async (client, { projectId, workspaceId }) => {
    const { actionsQueries } = await import('@/lib/api/actions');
    warmQuery(client, actionsQueries.list(workspaceId, projectId));
  },
  '/agent/skills': async (client, { workspaceId }) => {
    const { agentQueries } = await import('@/lib/api/agent');
    warmQuery(client, agentQueries.skills(workspaceId));
  },
  '/agent/context': async (client, { projectId, workspaceId }) => {
    // The profile fills the first tab; the brand-facts gate decides which tabs exist.
    const { projectQueries } = await import('@/lib/api/projects');
    warmQuery(client, projectQueries.brandProfile(workspaceId, projectId));
    warmQuery(client, projectQueries.brandFacts(workspaceId, projectId));
  },
  '/prompts': async (client, { projectId, workspaceId }) => {
    const [{ promptsQueries }, { topicsQueries }, { visibilityQueries }] = await Promise.all([
      import('@/lib/api/prompts'),
      import('@/lib/api/topics'),
      import('@/lib/api/visibility-queries'),
    ]);
    // The library's three independent reads: its sets, its topic filter, and
    // what the latest run measured for each prompt.
    const scope = { workspaceId, projectId };
    warmQuery(client, promptsQueries.sets(scope));
    warmQuery(client, topicsQueries.list(scope));
    warmQuery(client, visibilityQueries.latestPrompts(workspaceId, projectId));
  },
  '/visibility': async (client, { projectId, workspaceId }) => {
    const [{ runsQueries }, { INITIAL_VISIBILITY_PARAMS }, { visibilityQueries }, { projectsApi }] =
      await Promise.all([
        import('@/lib/api/runs'),
        import('@/lib/api/visibility'),
        import('@/lib/api/visibility-queries'),
        import('@/lib/api/projects'),
      ]);
    warmQuery(client, runsQueries.list(workspaceId, projectId));
    // The market picker's list, which the screen reads beside the runs.
    warmQuery(client, {
      queryKey: queryKeys.projects.markets(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        projectsApi.listMarkets(projectId, { signal, workspaceId }),
    });
    // The landing selection, built from the screen's own defaults. A key
    // spelled out here drifted from the one the screen reads and warmed an
    // entry nothing consumed.
    warmQuery(client, visibilityQueries.project(workspaceId, projectId, INITIAL_VISIBILITY_PARAMS));
  },
  '/runs': async (client, { projectId, workspaceId }) => {
    const { runsQueries } = await import('@/lib/api/runs');
    warmQuery(client, runsQueries.list(workspaceId, projectId));
  },
  '/ai-traffic': async (client, { projectId, workspaceId }) => {
    const [{ aiTrafficQueries }, { TRAFFIC_RANGES }] = await Promise.all([
      import('@/lib/api/ai-traffic'),
      import('@/lib/config/crawl-logs'),
    ]);
    // The landing view's three reads, side by side: the sources that choose
    // the default tab, and the Overview tab's summary and insights.
    const range = TRAFFIC_RANGES[0].value;
    warmQuery(client, aiTrafficQueries.sources(workspaceId, projectId));
    warmQuery(client, aiTrafficQueries.overview(workspaceId, projectId, { range }));
    warmQuery(client, aiTrafficQueries.insights(workspaceId, projectId, range));
  },
};

/**
 * Warm the Overview's two independent reads side by side — the command center
 * and the layout — and, once the layout names its widgets, the reads those
 * widgets make. The screen used to ask for each of these only after the one
 * before it had rendered: three or four round trips in a row.
 */
async function prefetchOverview(client: QueryClient, { projectId, workspaceId }: ProjectScope) {
  const [{ projectQueries }, { warmOverviewWidgets }] = await Promise.all([
    import('@/lib/api/projects'),
    import('@/lib/overview/widget-queries'),
  ]);
  warmQuery(client, projectQueries.commandCenter(workspaceId, projectId));
  const layoutQuery = projectQueries.overviewLayout(workspaceId, projectId);
  warmQuery(client, layoutQuery);
  if (client.getQueryState(layoutQuery.queryKey)?.status === 'error') return;
  const layout = await client.ensureQueryData(layoutQuery).catch(() => null);
  if (layout)
    await warmOverviewWidgets(client, { id: projectId, workspace_id: workspaceId }, layout.widgets);
}

/**
 * Warm the Website screen's dashboard and, beside it, the page preview the
 * screen requests once the dashboard names its crawl.
 *
 * A cached dashboard already names the crawl, so the preview is warmed under
 * it directly. Otherwise the project-scoped read answers for the newest crawl
 * (the one the dashboard shows) and names it, and the answer is filed under
 * that crawl's key — the preview no longer waits a round trip for the
 * dashboard. Only a finished crawl's answer is filed: an active crawl's
 * preview shows completed rows only, which is a different key.
 */
async function prefetchSiteHealth(client: QueryClient, { projectId, workspaceId }: ProjectScope) {
  const [{ siteHealthQueries }, { latestCrawlQueries }, screen, { shouldPollCrawl }] =
    await Promise.all([
      import('@/lib/api/site-health'),
      import('@/lib/api/site-health-latest-crawl'),
      import('@/lib/site-health/use-site-health-screen'),
      import('@/lib/site-health/status'),
    ]);
  const dashboard = siteHealthQueries.dashboard(workspaceId, projectId);
  const cached = client.getQueryData(dashboard.queryKey);
  warmQuery(client, dashboard);
  // The monitored set supplies the analysis progress totals; it needs only the project.
  warmQuery(client, siteHealthQueries.monitored(workspaceId, projectId));
  if (cached) {
    const preview = screen.pagePreviewQuery(workspaceId, cached);
    if (preview) warmQuery(client, preview);
    return;
  }
  const params = screen.monitoredPagePreviewParams(false);
  const latest = await readFromIntent(
    client,
    latestCrawlQueries.pages(workspaceId, projectId, params),
  );
  if (!latest) return;
  const { crawl_id: crawlId, crawl_status: status, ...page } = latest;
  const key = siteHealthQueries.pages(workspaceId, crawlId, params).queryKey;
  if (!shouldPollCrawl({ status }) && client.getQueryData(key) === undefined)
    client.setQueryData(key, page);
}

/**
 * Warm the issues page itself, not only the dashboard above it.
 *
 * The catalog asks one crawl for its issues, and only the dashboard names the
 * crawl. A cached dashboard warms the catalog under its crawl directly;
 * otherwise the project-scoped read answers for the newest crawl (the one the
 * dashboard shows), beside the dashboard rather than after it, and its answer
 * is filed under the crawl it names.
 *
 * Only the DEFAULT page is warmed. A reader arriving with filters in the
 * address wants a different key, and warming this one would spend a request on
 * a page they will not see.
 */
async function prefetchIssues(client: QueryClient, { projectId, workspaceId }: ProjectScope) {
  const [{ siteHealthQueries }, { latestCrawlQueries }, { emptyIssueFilters, issueCatalogParams }] =
    await Promise.all([
      import('@/lib/api/site-health'),
      import('@/lib/api/site-health-latest-crawl'),
      import('@/lib/site-health/issue-filters'),
    ]);
  const dashboard = siteHealthQueries.dashboard(workspaceId, projectId);
  const cachedCrawlId = client.getQueryData(dashboard.queryKey)?.crawl?.id;
  warmQuery(client, dashboard);
  // The identical params `IssuesCatalog` builds for an unfiltered first page.
  // Spelling them out differently here would warm a key nothing reads.
  const params = issueCatalogParams(emptyIssueFilters, null);
  if (cachedCrawlId) {
    warmQuery(client, siteHealthQueries.issues(workspaceId, cachedCrawlId, params));
    return;
  }
  const latest = await readFromIntent(
    client,
    latestCrawlQueries.issues(workspaceId, projectId, params),
  );
  if (!latest) return;
  const { crawl_id: crawlId, ...page } = latest;
  const key = siteHealthQueries.issues(workspaceId, crawlId, params).queryKey;
  if (client.getQueryData(key) === undefined) client.setQueryData(key, page);
}

/**
 * Warm the reads the application shell makes for a project on every screen:
 * the Actions badge beside the navigation reads the unfiltered first page of
 * the project's Actions. Its component loads lazily, so on a cold load the
 * read otherwise started a round trip after the page's own.
 */
export function prefetchProjectShell(
  client: QueryClient,
  { projectId, workspaceId }: ProjectScope,
): Promise<void> {
  return import('@/lib/api/actions')
    .then(({ actionsQueries }) => warmQuery(client, actionsQueries.list(workspaceId, projectId)))
    .catch(() => {});
}

/**
 * Warm a destination's route code and, with a project, its primary read.
 *
 * Settles, never rejects, once every read the destination warms has been
 * issued — nothing needs to wait for that except a caller withdrawing those
 * reads, which must not run before they exist.
 */
export function prefetchRoute(
  client: QueryClient,
  href: string,
  project: ProjectScope | null,
): Promise<void> {
  const pathname = new URL(href, 'https://citeladder.local').pathname;
  preloadRouteChunk(pathname);
  const route = findAppRoute(pathname);
  // Only a destination's own path warms its read; a record under it has its own.
  const prefetcher =
    project && route?.path === pathname ? ROUTE_PREFETCHERS[route.path] : undefined;
  if (!project || !prefetcher) return Promise.resolve();
  // Intent is best-effort: a chunk that fails to load must not surface here,
  // and the navigation that follows will report the failure properly.
  return prefetcher(client, project).catch(() => {});
}
