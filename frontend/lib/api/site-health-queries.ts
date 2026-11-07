/**
 * Site Health query and mutation descriptors: screens, the route prefetchers
 * and cursor tables read through these, and each write refreshes every read it
 * changes.
 */
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { PageDetail } from '@citeladder/contracts';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import { retainPreviousDataForScope } from './query-client';
import {
  siteHealthApi,
  type ChangesPageRequest,
  type CrawlListParams,
  type InventoryParams,
  type IssueDetailParams,
  type IssueHistoryParams,
  type IssuesParams,
  type PagesParams,
  type RobotsPage,
  type StartCrawlInput,
} from './site-health';

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

/**
 * React Query option factories. Screens, the route prefetchers and cursor
 * tables pass these straight to `useQuery`, so the query key ↔ endpoint
 * pairing lives in one place. Project reads take the project scope; a
 * crawl's reads take the workspace and the crawl. Every `queryFn` forwards
 * the abort signal.
 */
export const siteHealthQueries = {
  robotsHistory: (scope: ProjectScope, page: RobotsPage) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.robotsHistory(scope, page),
      // Opening history refreshes the project's observation sequence, irrespective of selected crawl.
      refetchOnMount: 'always',
      queryFn: ({ signal }) =>
        siteHealthApi.getRobotsHistory(scope.projectId, page, scoped(scope, signal)),
    }),
  dashboard: (scope: ProjectScope, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.dashboard(scope, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getDashboard(scope.projectId, crawlId, scoped(scope, signal)),
    }),
  aeoReadiness: (scope: ProjectScope, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.aeoReadiness(scope, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getAeoReadiness(scope.projectId, crawlId, scoped(scope, signal)),
    }),
  overview: (scope: ProjectScope, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.overview(scope, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getOverview(scope.projectId, crawlId, scoped(scope, signal)),
    }),
  architecture: (scope: ProjectScope, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.architecture(scope, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getArchitecture(scope.projectId, crawlId, scoped(scope, signal)),
    }),
  changesSummary: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.changesSummary(scope),
      queryFn: ({ signal }) =>
        siteHealthApi.getChangesSummary(scope.projectId, scoped(scope, signal)),
    }),
  /** One page of a compared pair's changes; the summary names the pair. */
  changes: (scope: ProjectScope, page: ChangesPageRequest) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.changes(scope, page),
      queryFn: ({ signal }) => {
        const { crawlAId, crawlBId, cursor, limit } = page;
        if (!crawlAId || !crawlBId) throw new Error('A persisted crawl pair is required');
        return siteHealthApi.getChanges(
          scope.projectId,
          crawlAId,
          crawlBId,
          cursor,
          limit,
          scoped(scope, signal),
        );
      },
    }),
  crawls: (scope: ProjectScope, page: Omit<CrawlListParams, 'project_id'> = {}) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.crawls(scope, {
        limit: page.limit ?? null,
        cursor: page.cursor ?? null,
      }),
      queryFn: ({ signal }) =>
        siteHealthApi.listCrawls({ project_id: scope.projectId, ...page }, scoped(scope, signal)),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(scope.projectId, previousData, previousQuery),
    }),
  monitored: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.monitored(scope),
      queryFn: ({ signal }) =>
        siteHealthApi.getMonitoredUrls(scope.projectId, scoped(scope, signal)),
    }),
  crawl: (workspaceId: string | null, crawlId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.crawl(workspaceId, crawlId),
      queryFn: ({ signal }) => siteHealthApi.getCrawl(crawlId, { signal, workspaceId }),
    }),
  inventory: (workspaceId: string | null, crawlId: string, params?: InventoryParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.inventory(workspaceId, crawlId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
        query: params?.query ?? null,
        status: params?.status ?? null,
        monitored: params?.monitored ?? null,
        page_kind: params?.page_kind ?? null,
      }),
      queryFn: ({ signal }) => siteHealthApi.getInventory(crawlId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
  pages: (workspaceId: string | null, crawlId: string, params?: PagesParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.pages(workspaceId, crawlId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
        status: params?.status ?? null,
        monitored: params?.monitored ?? null,
        page_kind: params?.page_kind ?? null,
        // The sort changes the server's ordering, so it must be part of the
        // cache identity — otherwise two sorts share one entry and the table
        // renders the previous ordering's rows.
        sort: params?.sort ?? null,
      }),
      queryFn: ({ signal }) => siteHealthApi.getPages(crawlId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
  page: (workspaceId: string | null, crawlId: string, siteUrlId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.page(workspaceId, crawlId, siteUrlId),
      queryFn: ({ signal }) => siteHealthApi.getPage(crawlId, siteUrlId, { signal, workspaceId }),
    }),
  issues: (workspaceId: string | null, crawlId: string, params?: IssuesParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issues(workspaceId, crawlId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
        query: params?.query ?? null,
        severity: params?.severity ?? null,
        category: params?.category ?? null,
        dimension: params?.dimension ?? null,
        rule: params?.rule ?? null,
        site_url_id: params?.site_url_id ?? null,
        finding_class: params?.finding_class ?? 'defect',
        page_kind: params?.page_kind ?? null,
        detail_limit: params?.detail_limit ?? null,
      }),
      queryFn: ({ signal }) => siteHealthApi.getIssues(crawlId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
  issue: (
    workspaceId: string | null,
    crawlId: string,
    groupId: string,
    params?: IssueDetailParams,
  ) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issue(workspaceId, crawlId, groupId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
        page_kind: params?.page_kind ?? null,
      }),
      queryFn: ({ signal }) =>
        siteHealthApi.getIssue(crawlId, groupId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
  issueHistory: (
    workspaceId: string | null,
    crawlId: string,
    siteUrlId: string,
    params?: IssueHistoryParams,
  ) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issueHistory(workspaceId, crawlId, siteUrlId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
      }),
      queryFn: ({ signal }) =>
        siteHealthApi.getIssueHistory(crawlId, siteUrlId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
};

/*
 * ONE definition of "what a crawl change refreshes".
 *
 * The Site Health screen used to run five independent 4s polls over the same
 * crawl (dashboard, pages, and three list views), each owning its own timer,
 * while the SSE hook invalidated a hand-listed set of keys on every frame.
 * Overlapping refetches then resolved out of order and panels rendered state
 * from different moments — counts ticking backwards, a score appearing then
 * vanishing. Now there is a single subscription (the dashboard query's timer)
 * plus the stream, and BOTH refresh the derived views through these helpers,
 * so the two paths can never drift apart.
 */

/**
 * Refresh every list view derived from a crawl: the crawl row and the first
 * page of the pages / inventory / issues lists, across all filter
 * combinations. Deeper cursor pages are deliberately left alone: the reader is
 * looking at a fixed window of rows, and refetching it as new URLs stream in
 * shifts the rows under their cursor.
 */
export function refreshCrawlViews(client: QueryClient, crawlId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.siteHealth.crawlRow(crawlId) }),
    ...[
      queryKeys.siteHealth.crawlPages(crawlId),
      queryKeys.siteHealth.crawlInventory(crawlId),
      queryKeys.siteHealth.crawlIssues(crawlId),
    ].map((queryKey) =>
      client.invalidateQueries({
        queryKey,
        predicate: (query) => queryKeys.siteHealth.isFirstPage(query.queryKey),
      }),
    ),
  ]);
}

/**
 * The project's crawl + phase projection, in every workspace and for every
 * selected crawl. The dashboard's own poll must not call this: it is the
 * trigger.
 */
export const refreshSiteHealthDashboard = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.siteHealth.resource(projectId, 'dashboard') });

/**
 * The project-level monitored projection, while automatic admission is still
 * growing it. It is not crawl-owned data, so it stays out of
 * `refreshCrawlViews`: callers decide when a crawl progress change can also
 * have changed the persistent monitored set.
 */
export const refreshMonitoredUrls = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.siteHealth.resource(projectId, 'monitored') });

/**
 * What a created crawl changes: the project's projection, and the monitored
 * set automatic admission adds the root to. Any in-flight dashboard read stops
 * first, so a pre-create answer cannot commit after creation and read as the
 * acknowledgement.
 */
async function refreshCrawlStart(client: QueryClient, projectId: string) {
  await client.cancelQueries({ queryKey: queryKeys.siteHealth.resource(projectId, 'dashboard') });
  await Promise.all([
    refreshSiteHealthDashboard(client, projectId),
    refreshMonitoredUrls(client, projectId),
  ]);
}

/**
 * A crawl start's projection refresh. The mutation settles at the POST, so a
 * slow projection read can neither hold the control pending nor report a
 * failure for a crawl that already exists; a caller that waits for the
 * refreshed projection awaits `refreshed` from its own `onSuccess`.
 */
export type CrawlStart = { refreshed: Promise<void> | null };

/** Site Health writes; each success refreshes every read it changes. */
export const siteHealthMutations = {
  createCrawl: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (input: StartCrawlInput) => siteHealthApi.createCrawl(input, { workspaceId }),
      onMutate: (): CrawlStart => ({ refreshed: null }),
      onSuccess: (_crawl, input, start, { client }) => {
        start.refreshed = refreshCrawlStart(client, input.project_id);
      },
    }),
  /**
   * Cancellation also changes the server-owned phase, so the whole projection
   * refreshes at once instead of pairing the terminal crawl row with an
   * active phase in the cache.
   */
  cancelCrawl: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (crawlId: string) => siteHealthApi.cancelCrawl(crawlId, scoped(scope)),
      onSuccess: (_crawl, _crawlId, _result, { client }) =>
        refreshSiteHealthDashboard(client, scope.projectId),
    }),
  /**
   * A per-URL rerun. Rerun inside the same crawl refreshes the URL's detail
   * before the caller starts polling it: polling first can observe the stale
   * terminal entry and stop before the fresh pending snapshot lands. A rerun
   * that minted a new crawl seeds that crawl's entry with the new identity.
   */
  rerunPage: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { crawlId: string; siteUrlId: string }) =>
        siteHealthApi.rerunPage(vars.crawlId, vars.siteUrlId, { workspaceId }),
      onSuccess: async (result, vars, _result, { client }) => {
        if (result.crawl_id === vars.crawlId && result.site_url_id === vars.siteUrlId) {
          await client.invalidateQueries({
            queryKey: queryKeys.siteHealth.crawlPage(vars.crawlId, vars.siteUrlId),
          });
          return;
        }
        client.setQueryData<PageDetail>(
          queryKeys.siteHealth.page(workspaceId, result.crawl_id, result.site_url_id),
          (previous) =>
            previous
              ? { ...previous, crawl_id: result.crawl_id, analysis_status: result.analysis_status }
              : previous,
        );
      },
    }),
};
