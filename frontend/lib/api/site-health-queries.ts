import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { isTerminalCrawl, type IssueFixes, type PageDetail } from '@citeladder/contracts';
import type { CrawlScheduleUpdateRequest } from '@citeladder/contracts/site-health-requests';
import { ISSUE_RERUN_MAX_POLLS, RERUN_POLL_INTERVAL_MS } from '@/lib/config/site-health';
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

const ISSUE_KEY_PARAMS = [
  'cursor',
  'limit',
  'query',
  'severity',
  'category',
  'dimension',
  'rule',
  'site_url_id',
  'page_kind',
  'section',
  'sort',
  'finding_class',
] as const satisfies ReadonlyArray<keyof IssuesParams>;

function issueKeyFilters(params: IssuesParams = {}) {
  return Object.fromEntries(ISSUE_KEY_PARAMS.map((name) => [name, params[name] ?? null]));
}

export const siteHealthQueries = {
  robotsHistory: (scope: ProjectScope, page: RobotsPage) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.robotsHistory(scope, page),
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
  crawlSchedule: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.crawlSchedule(scope),
      queryFn: ({ signal }) =>
        siteHealthApi.getCrawlSchedule(scope.projectId, scoped(scope, signal)),
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
        query: params?.query ?? null,
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
      queryKey: queryKeys.siteHealth.issues(workspaceId, crawlId, issueKeyFilters(params)),
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
  issueFixes: (workspaceId: string | null, crawlId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issueFixes(workspaceId, crawlId),
      queryFn: ({ signal }) => siteHealthApi.getIssueFixes(crawlId, { signal, workspaceId }),
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

export const refreshMonitoredUrls = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.siteHealth.resource(projectId, 'monitored') });

/**
 * What a created crawl changes: the project's projection, and the monitored
 * set automatic admission adds the root to. Any in-flight dashboard read stops
 * first, so a pre-create answer cannot commit after creation and read as the
 * acknowledgement.
 */
async function refreshWhenRerunLands(
  client: QueryClient,
  scope: ProjectScope,
  crawlId: string,
  rerunCrawlId: string,
) {
  const rerun = siteHealthQueries.crawl(scope.workspaceId, rerunCrawlId);
  for (let poll = 0; poll < ISSUE_RERUN_MAX_POLLS; poll += 1) {
    const crawl = await client.fetchQuery({ ...rerun, staleTime: 0 }).catch(() => null);
    if (crawl && isTerminalCrawl(crawl.status)) {
      await Promise.all([
        refreshCrawlViews(client, crawlId),
        client.invalidateQueries({ queryKey: queryKeys.siteHealth.crawlIssueDetails(crawlId) }),
        client.invalidateQueries({ queryKey: queryKeys.siteHealth.crawlIssueFixes(crawlId) }),
        client.invalidateQueries({
          queryKey: queryKeys.siteHealth.resource(scope.projectId, 'overview'),
        }),
      ]);
      return;
    }
    await /* NOSONAR -- Poll interval between rerun checks. */ new Promise<void>((resolve) => {
      setTimeout(resolve, RERUN_POLL_INTERVAL_MS);
    });
  }
}

async function refreshCrawlStart(client: QueryClient, projectId: string) {
  await client.cancelQueries({ queryKey: queryKeys.siteHealth.resource(projectId, 'dashboard') });
  await Promise.all([
    refreshSiteHealthDashboard(client, projectId),
    refreshMonitoredUrls(client, projectId),
  ]);
}

export type CrawlStart = { refreshed: Promise<void> | null };

export const siteHealthMutations = {
  createCrawl: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (input: StartCrawlInput) => siteHealthApi.createCrawl(input, { workspaceId }),
      onMutate: (): CrawlStart => ({ refreshed: null }),
      onSuccess: (_crawl, input, start, { client }) => {
        start.refreshed = refreshCrawlStart(client, input.project_id);
      },
    }),
  updateCrawlSchedule: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: CrawlScheduleUpdateRequest) =>
        siteHealthApi.updateCrawlSchedule(scope.projectId, input, scoped(scope)),
      onSuccess: (schedule, _input, _result, { client }) =>
        client.setQueryData(queryKeys.siteHealth.crawlSchedule(scope), schedule),
    }),
  cancelCrawl: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (crawlId: string) => siteHealthApi.cancelCrawl(crawlId, scoped(scope)),
      onSuccess: (_crawl, _crawlId, _result, { client }) =>
        refreshSiteHealthDashboard(client, scope.projectId),
    }),
  markIssueFixed: (workspaceId: string | null, crawlId: string) =>
    mutationOptions({
      mutationFn: (groupId: string) =>
        siteHealthApi.markIssueFixed(crawlId, groupId, { workspaceId }),
      onSuccess: (progress, _groupId, _result, { client }) =>
        client.setQueryData<IssueFixes>(
          queryKeys.siteHealth.issueFixes(workspaceId, crawlId),
          (previous) =>
            previous && {
              ...previous,
              items: previous.items.map((item) =>
                item.group_id === progress.group_id ? progress : item,
              ),
            },
        ),
    }),
  rerunIssue: (scope: ProjectScope, crawlId: string) =>
    mutationOptions({
      mutationFn: (groupId: string) => siteHealthApi.rerunIssue(crawlId, groupId, scoped(scope)),
      onSuccess: (rerun, _groupId, _result, { client }) => {
        void refreshWhenRerunLands(client, scope, crawlId, rerun.crawl_id);
      },
    }),
  rerunPage: (workspaceId: string | null) =>
    mutationOptions({
      mutationFn: (vars: { crawlId: string; siteUrlId: string }) =>
        siteHealthApi.rerunPage(vars.crawlId, vars.siteUrlId, { workspaceId }),
      onSuccess: (result, _vars, _result, { client }) => {
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
