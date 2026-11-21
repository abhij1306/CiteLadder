import type { QueryClient } from '@tanstack/react-query';

import { readFromIntent, warmQuery } from '@/lib/api/query-client';
import { findAppRoute, type AppRoutePath } from '@/lib/navigation/app-routes';
import { preloadRouteChunk } from '@/lib/navigation/route-chunks';

export type ProjectScope = { projectId: string; workspaceId: string };

type Warm<M> = (
  modules: M,
  client: QueryClient,
  scope: ProjectScope,
  search: URLSearchParams,
) => void | Promise<void>;

type RouteReads = Readonly<{
  load: () => Promise<unknown>;
  prefetch: (client: QueryClient, scope: ProjectScope, search: URLSearchParams) => Promise<void>;
}>;

function routeReads<M>(load: () => Promise<M>, warm: Warm<M>): RouteReads {
  return {
    load,
    prefetch: async (client, scope, search) => warm(await load(), client, scope, search),
  };
}

const opensOn = (search: URLSearchParams, defaultTab: string) =>
  (search.get('tab') ?? defaultTab) === defaultTab;

const visibilitySelection = () =>
  Promise.all([
    import('@/lib/api/runs'),
    import('@/lib/api/visibility'),
    import('@/lib/api/visibility-queries'),
    import('@/lib/api/projects'),
  ]);

const warmVisibilitySelection: Warm<Awaited<ReturnType<typeof visibilitySelection>>> = (
  [{ runsQueries }, { INITIAL_VISIBILITY_PARAMS }, { visibilityQueries }, { projectQueries }],
  client,
  scope,
) => {
  warmQuery(client, runsQueries.list(scope));
  warmQuery(client, projectQueries.markets(scope));
  warmQuery(client, visibilityQueries.project(scope, INITIAL_VISIBILITY_PARAMS));
};

const ROUTE_READS: Readonly<Partial<Record<AppRoutePath, RouteReads>>> = {
  '/projects': routeReads(
    () => Promise.all([import('@/lib/api/projects'), import('@/lib/overview/widget-queries')]),
    warmOverview,
  ),
  '/site': routeReads(
    () =>
      Promise.all([
        import('@/lib/api/site-health-queries'),
        import('@/lib/api/site-health-latest-crawl'),
        import('@/lib/site-health/use-site-health-screen'),
        import('@/lib/site-health/status'),
      ]),
    warmSiteHealth,
  ),
  '/issues': routeReads(
    () =>
      Promise.all([
        import('@/lib/api/site-health-queries'),
        import('@/lib/api/site-health-latest-crawl'),
        import('@/lib/site-health/issue-filters'),
      ]),
    warmIssues,
  ),
  '/performance': routeReads(
    () => Promise.all([import('@/lib/api/performance'), import('@/lib/performance/performance')]),
    ([{ performanceQueries }, { INITIAL_DASHBOARD_PARAMS }], client, scope) =>
      warmQuery(client, performanceQueries.dashboard(scope, INITIAL_DASHBOARD_PARAMS)),
  ),
  '/search-intelligence': routeReads(
    () => Promise.all([import('@/lib/api/demand'), import('@/lib/api/search-intelligence')]),
    ([{ demandQueries }, { searchIntelligenceQueries }], client, scope, search) => {
      if (opensOn(search, 'demand')) warmQuery(client, demandQueries.latest(scope));
      else warmQuery(client, searchIntelligenceQueries.readiness(scope));
    },
  ),
  '/products': routeReads(
    () => Promise.all([import('@/lib/api/commerce'), import('@/lib/products/product-filters')]),
    ([{ commerceQueries }, { DEFAULT_PRODUCT_FILTERS, productSearch }], client, scope) => {
      warmQuery(client, commerceQueries.catalog(scope));
      warmQuery(
        client,
        commerceQueries.products(scope, productSearch(DEFAULT_PRODUCT_FILTERS), null),
      );
    },
  ),
  '/products/overview': routeReads(
    () => Promise.all([import('@/lib/api/commerce'), import('@/lib/products/product-filters')]),
    ([{ commerceQueries }, { DEFAULT_OVERVIEW_FILTERS, overviewSearch }], client, scope) => {
      warmQuery(client, commerceQueries.catalog(scope));
      warmQuery(client, commerceQueries.overview(scope, overviewSearch(DEFAULT_OVERVIEW_FILTERS)));
    },
  ),
  '/agent': routeReads(
    () => import('@/lib/api/actions'),
    ({ actionsQueries }, client, scope) => warmQuery(client, actionsQueries.list(scope)),
  ),
  '/actions': routeReads(
    () => import('@/lib/api/actions'),
    ({ actionsQueries, DEFAULT_ACTION_TREE }, client, scope) =>
      warmQuery(client, actionsQueries.tree(scope, DEFAULT_ACTION_TREE)),
  ),
  '/agent/skills': routeReads(
    () => import('@/lib/api/agent'),
    ({ agentQueries }, client, { workspaceId }) =>
      warmQuery(client, agentQueries.skills(workspaceId)),
  ),
  '/agent/context': routeReads(
    () => import('@/lib/api/projects'),
    ({ projectQueries }, client, scope) => {
      warmQuery(client, projectQueries.brandProfile(scope));
      warmQuery(client, projectQueries.brandFacts(scope));
    },
  ),
  '/prompts': routeReads(
    () =>
      Promise.all([
        import('@/lib/api/prompts'),
        import('@/lib/api/topics'),
        import('@/lib/api/visibility-queries'),
        import('@/lib/prompts/prompt-sets'),
      ]),
    warmPrompts,
  ),
  '/prompts/build': routeReads(
    () => Promise.all([import('@/lib/api/projects'), import('@/lib/api/prompts')]),
    ([{ projectQueries }, { promptsQueries }], client, scope) => {
      warmQuery(client, projectQueries.brandProfile(scope));
      warmQuery(client, projectQueries.businessMap(scope));
      warmQuery(client, promptsQueries.sets(scope));
    },
  ),
  '/visibility': routeReads(visibilitySelection, warmVisibilitySelection),
  '/insights': routeReads(visibilitySelection, warmVisibilitySelection),
  '/competitors': routeReads(visibilitySelection, warmVisibilitySelection),
  '/perception': routeReads(visibilitySelection, (modules, client, scope, search) => {
    warmQuery(client, modules[3].projectQueries.brandFacts(scope));
    return warmVisibilitySelection(modules, client, scope, search);
  }),
  '/runs': routeReads(
    () => import('@/lib/api/runs'),
    ({ runsQueries }, client, scope) => warmQuery(client, runsQueries.list(scope)),
  ),
  '/ai-traffic': routeReads(
    () => Promise.all([import('@/lib/api/ai-traffic'), import('@/lib/config/crawl-logs')]),
    ([{ aiTrafficQueries }, { TRAFFIC_RANGES }], client, scope, search) => {
      const range = TRAFFIC_RANGES[0].value;
      warmQuery(client, aiTrafficQueries.sources(scope));
      if (!opensOn(search, 'overview')) return;
      warmQuery(client, aiTrafficQueries.overview(scope, { range }));
      warmQuery(client, aiTrafficQueries.insights(scope, range));
    },
  ),
  '/settings': routeReads(
    () =>
      Promise.all([
        import('@/lib/api/auth'),
        import('@/lib/api/providers'),
        import('@/lib/api/integrations'),
        import('@/lib/api/mcp-connections'),
      ]),
    warmSettings,
  ),
};

function warmSettings(
  [{ authQueries }, { providerQueries }, { integrationsQueries }, { mcpConnectionQueries }]: [
    typeof import('@/lib/api/auth'),
    typeof import('@/lib/api/providers'),
    typeof import('@/lib/api/integrations'),
    typeof import('@/lib/api/mcp-connections'),
  ],
  client: QueryClient,
  { workspaceId }: ProjectScope,
  search: URLSearchParams,
) {
  warmQuery(client, authQueries.security());
  warmQuery(client, providerQueries.catalog());
  warmQuery(client, providerQueries.connections(workspaceId));
  warmQuery(client, providerQueries.states(workspaceId));
  const tab = search.get('tab');
  if (tab === 'integrations') warmQuery(client, integrationsQueries.connections(workspaceId));
  if (tab === 'connections') warmQuery(client, mcpConnectionQueries.list(workspaceId));
}

async function warmPrompts(
  [{ promptsQueries }, { topicsQueries }, { visibilityQueries }, { mainPromptSet }]: [
    typeof import('@/lib/api/prompts'),
    typeof import('@/lib/api/topics'),
    typeof import('@/lib/api/visibility-queries'),
    typeof import('@/lib/prompts/prompt-sets'),
  ],
  client: QueryClient,
  scope: ProjectScope,
) {
  const sets = promptsQueries.sets(scope);
  warmQuery(client, sets);
  warmQuery(client, topicsQueries.list(scope));
  warmQuery(client, visibilityQueries.latestPerPrompt(scope));
  const main = mainPromptSet((await readFromIntent(client, sets))?.prompt_sets ?? []);
  if (main) warmQuery(client, promptsQueries.candidates(scope, main.id));
}

async function warmOverview(
  [{ projectQueries }, { warmOverviewWidgets }]: [
    typeof import('@/lib/api/projects'),
    typeof import('@/lib/overview/widget-queries'),
  ],
  client: QueryClient,
  scope: ProjectScope,
) {
  warmQuery(client, projectQueries.commandCenter(scope));
  const layoutQuery = projectQueries.overviewLayout(scope);
  warmQuery(client, layoutQuery);
  if (client.getQueryState(layoutQuery.queryKey)?.status === 'error') return;
  const layout = await client.ensureQueryData(layoutQuery).catch(() => null);
  if (layout)
    await warmOverviewWidgets(
      client,
      { id: scope.projectId, workspace_id: scope.workspaceId },
      layout.widgets,
    );
}

async function warmSiteHealth(
  [{ siteHealthQueries }, { latestCrawlQueries }, screen, { CRAWL_STATES }]: [
    typeof import('@/lib/api/site-health-queries'),
    typeof import('@/lib/api/site-health-latest-crawl'),
    typeof import('@/lib/site-health/use-site-health-screen'),
    typeof import('@/lib/site-health/status'),
  ],
  client: QueryClient,
  scope: ProjectScope,
) {
  const { workspaceId } = scope;
  const dashboard = siteHealthQueries.dashboard(scope);
  const cached = client.getQueryData(dashboard.queryKey);
  warmQuery(client, dashboard);
  if (cached) {
    const preview = screen.pagePreviewQuery(workspaceId, cached);
    if (preview) warmQuery(client, preview);
    return;
  }
  const params = screen.monitoredPagePreviewParams(false);
  const latest = await readFromIntent(client, latestCrawlQueries.pages(scope, params));
  if (!latest) return;
  const { crawl_id: crawlId, crawl_status: status, ...page } = latest;
  const key = siteHealthQueries.pages(workspaceId, crawlId, params).queryKey;
  if (!CRAWL_STATES[status].active && client.getQueryData(key) === undefined)
    client.setQueryData(key, page);
}

async function warmIssues(
  [
    { siteHealthQueries },
    { latestCrawlQueries },
    { emptyIssueFilters, issueCatalogParams, ISSUE_PRIORITY_PARAMS },
  ]: [
    typeof import('@/lib/api/site-health-queries'),
    typeof import('@/lib/api/site-health-latest-crawl'),
    typeof import('@/lib/site-health/issue-filters'),
  ],
  client: QueryClient,
  scope: ProjectScope,
) {
  const { workspaceId } = scope;
  const dashboard = siteHealthQueries.dashboard(scope);
  const cachedCrawlId = client.getQueryData(dashboard.queryKey)?.crawl?.id;
  warmQuery(client, dashboard);
  const params = issueCatalogParams(emptyIssueFilters, null);
  const warmSummary = (crawlId: string) =>
    warmQuery(client, siteHealthQueries.issues(workspaceId, crawlId, ISSUE_PRIORITY_PARAMS));
  if (cachedCrawlId) {
    warmQuery(client, siteHealthQueries.issues(workspaceId, cachedCrawlId, params));
    warmSummary(cachedCrawlId);
    return;
  }
  const latest = await readFromIntent(client, latestCrawlQueries.issues(scope, params));
  if (!latest) return;
  const { crawl_id: crawlId, ...page } = latest;
  const key = siteHealthQueries.issues(workspaceId, crawlId, params).queryKey;
  if (client.getQueryData(key) === undefined) client.setQueryData(key, page);
  warmSummary(crawlId);
}

const shellReads = () => import('@/lib/api/actions');

export function prefetchProjectShell(client: QueryClient, scope: ProjectScope): Promise<void> {
  return shellReads()
    .then(({ actionsQueries }) => warmQuery(client, actionsQueries.list(scope)))
    .catch(() => {});
}

function readsFor(pathname: string): RouteReads | undefined {
  const route = findAppRoute(pathname);
  return route?.path === pathname ? ROUTE_READS[route.path] : undefined;
}

export function preloadRouteReads(href: string): void {
  const { pathname } = new URL(href, 'https://citeladder.local');
  preloadRouteChunk(pathname);
  void shellReads().catch(() => {});
  void readsFor(pathname)
    ?.load()
    .catch(() => {});
}

export function prefetchRoute(
  client: QueryClient,
  href: string,
  project: ProjectScope | null,
): Promise<void> {
  const { pathname, searchParams } = new URL(href, 'https://citeladder.local');
  preloadRouteChunk(pathname);
  const reads = project ? readsFor(pathname) : undefined;
  if (!project || !reads) return Promise.resolve();
  return reads.prefetch(client, project, searchParams).catch(() => {});
}
