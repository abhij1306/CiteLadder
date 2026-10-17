import type { QueryClient } from '@tanstack/react-query';

import { warmQuery } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { preloadRouteChunk } from '@/lib/navigation/route-chunks';

type ProjectScope = { projectId: string; workspaceId: string };
type RoutePrefetcher = (client: QueryClient, scope: ProjectScope) => Promise<void>;

/**
 * Primary read intent for data-heavy application destinations. Query keys are
 * identical to each screen's default request, so pointer and keyboard intent
 * warm the existing domain cache rather than creating a navigation cache.
 *
 * **Every prefetcher imports its API module dynamically, and that is load-bearing.**
 * This map reaches ten domains. `sidebar-nav` imports it, `app-shell` imports
 * that, and the router imports the shell — so a static import here placed every
 * domain's client, and the Zod schema module behind each one, in the chunk the
 * browser must download before it can render anything at all. The whole point
 * of the map is that none of those reads have happened yet.
 *
 * The extra microtask before the request is free: nothing awaits a prefetch,
 * and the chunk is already warm by the second hover.
 */
const ROUTE_PREFETCHERS: Readonly<Record<string, RoutePrefetcher>> = {
  '/projects': async (client, { projectId, workspaceId }) => {
    const { projectsApi } = await import('@/lib/api/projects');
    warmQuery(client, {
      queryKey: queryKeys.projects.commandCenter(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        projectsApi.getCommandCenter(projectId, { signal, workspaceId }),
    });
  },
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
  '/products': async (client, { projectId, workspaceId }) => {
    const { commerceApi } = await import('@/lib/api/commerce');
    warmQuery(client, {
      queryKey: queryKeys.commerce.catalog(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        commerceApi.catalog(projectId, { signal, workspaceId }),
    });
  },
  '/agent/actions': async (client, { projectId, workspaceId }) => {
    const { actionsQueries } = await import('@/lib/api/actions');
    warmQuery(client, actionsQueries.list(workspaceId, projectId));
  },
  '/prompts': async (client, { projectId, workspaceId }) => {
    const { promptsApi } = await import('@/lib/api/prompts');
    warmQuery(client, {
      queryKey: queryKeys.prompts.sets(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        promptsApi.listPromptSets(projectId, { signal, workspaceId }),
    });
  },
  '/visibility': async (client, { projectId, workspaceId }) => {
    const [{ runsQueries }, { INITIAL_VISIBILITY_PARAMS, visibilityQueries }] = await Promise.all([
      import('@/lib/api/runs'),
      import('@/lib/api/visibility'),
    ]);
    warmQuery(client, runsQueries.list(workspaceId, projectId));
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
    const { aiTrafficApi } = await import('@/lib/api/ai-traffic');
    const { TRAFFIC_RANGES } = await import('@/lib/config/crawl-logs');
    const params = {
      range: TRAFFIC_RANGES[0].value,
      verification: undefined,
      purpose: undefined,
      bot_id: undefined,
      status: undefined,
      folder: undefined,
      resource_class: undefined,
    };
    warmQuery(client, {
      queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'overview', params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        aiTrafficApi.overview(projectId, params, { signal, workspaceId }),
    });
  },
};

async function prefetchSiteHealth(client: QueryClient, { projectId, workspaceId }: ProjectScope) {
  const { siteHealthQueries } = await import('@/lib/api/site-health');
  warmQuery(client, siteHealthQueries.dashboard(workspaceId, projectId));
}

/**
 * Warm the issues page itself, not only the dashboard above it.
 *
 * `/issues` needs two reads in sequence: the dashboard names the crawl, and
 * only then can the catalog ask that crawl for its issues. Warming the first
 * alone left the second — the one the screen actually blocks on — to start
 * cold on arrival, and the project context has usually warmed the dashboard
 * already anyway.
 *
 * Only the DEFAULT page is warmed. A reader arriving with filters in the
 * address wants a different key, and warming this one would spend a request on
 * a page they will not see.
 */
async function prefetchIssues(client: QueryClient, scope: ProjectScope) {
  const [{ siteHealthQueries }, { ISSUE_PAGE_LIMIT }, { emptyIssueFilters, toIssueParams }] =
    await Promise.all([
      import('@/lib/api/site-health'),
      import('@/lib/config/site-health'),
      import('@/lib/site-health/issue-filters'),
    ]);
  const dashboard = siteHealthQueries.dashboard(scope.workspaceId, scope.projectId);
  warmQuery(client, dashboard);

  const crawlId = (await client.ensureQueryData(dashboard).catch(() => null))?.crawl?.id;
  if (!crawlId) return;
  warmQuery(
    client,
    siteHealthQueries.issues(
      scope.workspaceId,
      crawlId,
      // The identical params `IssuesCatalog` builds for an unfiltered first
      // page. Spelling them out differently here would warm a key nothing reads.
      toIssueParams(emptyIssueFilters, null, ISSUE_PAGE_LIMIT),
    ),
  );
}

/** Warm a destination's route code and, with a project, its primary read. */
export function prefetchRoute(client: QueryClient, href: string, project: ProjectScope | null) {
  const pathname = new URL(href, 'https://citeladder.local').pathname;
  preloadRouteChunk(pathname);
  if (!project) return;
  // Intent is best-effort: a chunk that fails to load must not surface here,
  // and the navigation that follows will report the failure properly.
  void ROUTE_PREFETCHERS[pathname]?.(client, project).catch(() => {});
}
