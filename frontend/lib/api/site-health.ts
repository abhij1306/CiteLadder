/**
 * Site Health domain endpoints + query/mutation options.
 *
 * Owns transport for the Site Health slice: crawl create/list/
 * get/cancel, progressive keyset inventory, the persistent monitored set,
 * analyzed pages, issues, events, per-URL rerun, and same-origin export/stream
 * URLs. Every JSON response passes through `strictValidate` (fail loud on any
 * drift). All paths are relative `/api/v1` (same-origin proxy)
 * and every read accepts an `AbortSignal` via `ApiRequestOptions`.
 *
 * The frontend never invents a discovered total: count-bearing fields the
 * backend redacts arrive `null`/absent and are validated as such.
 */
import { mutationOptions, queryOptions } from '@tanstack/react-query';
import { SITE_HEALTH_EXECUTION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { startInteractiveWork } from './interactive-work';

import { API_BASE_URL, apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import { retainPreviousDataForScope } from './query-client';
import {
  aeoReadinessSchema,
  architectureSchema,
  changeSummarySchema,
  changesPageSchema,
  inventoryPageSchema,
  issueHistoryPageSchema,
  monitoredUrlsResponseSchema,
  pageDetailSchema,
  pagesPageSchema,
  rerunPageResponseSchema,
  siteCrawlListPageSchema,
  siteCrawlSchema,
  siteHealthDashboardSchema,
  siteHealthOverviewSchema,
  siteIssueDetailSchema,
  siteIssuesPageSchema,
  urlPreviewResponseSchema,
  robotsHistoryPageSchema,
} from '@citeladder/contracts/site-health';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import type {
  AeoReadiness,
  ChangeSummary,
  ChangesPage,
  InventoryPage,
  IssueHistoryPage,
  MonitoredUrlsResponse,
  PageDetail,
  PagesPage,
  RerunPageResponse,
  SiteCrawl,
  SiteArchitecture,
  SiteCrawlListPage,
  SiteHealthDashboard,
  SiteHealthOverview,
  SiteIssueDetail,
  SiteIssuesPage,
  UrlPreviewResponse,
} from './types';

/** `POST /site-crawls` body. Workspace is resolved from `X-Workspace-Id`. */
type CreateCrawlInput = {
  project_id: string;
  include_globs?: string[];
  exclude_globs?: string[];
  /**
   * Optional deterministic 64-bit seed as a decimal string. The backend
   * create contract names this `seed` (it aliases the model's `random_seed`),
   * so the wire field must be `seed`.
   */
  seed?: string;
  input_mode?: 'auto' | 'exact_urls' | 'discovery_seeds';
  requested_page_limit?: number;
  discovery_count?: number;
  seed_urls?: string[];
  page_kinds?: string[];
};
/** A new crawl, or with `recrawl_of` a rerun of that crawl's frozen scope and settings. */
export type StartCrawlInput = CreateCrawlInput & { recrawl_of?: string };
export type UrlPreviewInput = Pick<
  CreateCrawlInput,
  'project_id' | 'include_globs' | 'exclude_globs'
> & {
  content: string | string[] | Record<string, unknown>;
  input_format?: 'text' | 'csv' | 'json';
};

/** Keyset inventory query params. `limit<=200`, ordering is URL-only. */
export type InventoryParams = {
  cursor?: string;
  limit?: number;
  query?: string;
  status?: string;
  monitored?: boolean;
  /** v2 P1: filter to one classified page type (omitted = all types). */
  page_kind?: string;
};

type CrawlListParams = { project_id: string; limit?: number; cursor?: string };
/** Server-backed orderings of the pages list (keyset, never a client sort). */
export type PagesSort = 'status' | 'url' | 'inbound' | 'main_content_inbound' | 'depth';
export type PagesParams = {
  cursor?: string;
  limit?: number;
  status?: string;
  monitored?: boolean;
  /** v2 P1: filter to one classified page type (omitted = all types). */
  page_kind?: string;
  /** Ordering. Part of the cursor fingerprint, so changing it resets paging. */
  sort?: PagesSort;
};
export type IssuesParams = {
  cursor?: string;
  limit?: number;
  query?: string;
  severity?: string;
  category?: string;
  dimension?: string;
  rule?: string;
  site_url_id?: string;
  finding_class?: 'defect' | 'advisory';
  /** v2 P1: filter to issues affecting one classified page type. */
  page_kind?: string;
};

/** Keyset params for a grouped issue's affected-URL page and a URL's issue history. */
type IssueDetailParams = Pick<IssuesParams, 'cursor' | 'limit' | 'page_kind'>;
type IssueHistoryParams = Pick<IssuesParams, 'cursor' | 'limit'>;

export const siteHealthApi = {
  getRobotsHistory: async (projectId: string, cursor?: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get(
      withQuery(`/projects/${projectId}/site-health/robots-history`, definedQuery({ cursor })),
      options,
    );
    return strictValidate(robotsHistoryPageSchema, res, 'siteHealth.getRobotsHistory');
  },
  createCrawl: async ({ recrawl_of, ...input }: StartCrawlInput, options?: ApiRequestOptions) => {
    const path = recrawl_of ? `/site-crawls/${recrawl_of}/recrawl` : '/site-crawls';
    const res = await apiClient.post<SiteCrawl>(path, recrawl_of ? undefined : input, options);
    const crawl = strictValidate(siteCrawlSchema, res, 'siteHealth.createCrawl');
    startInteractiveWork(`/site-crawls/${crawl.id}/run`, {
      ...options,
      timeoutMs: SITE_HEALTH_EXECUTION_REQUEST_TIMEOUT_MS,
    });
    return crawl;
  },
  previewUrls: async (input: UrlPreviewInput, options?: ApiRequestOptions) => {
    const res = await apiClient.post<UrlPreviewResponse>(
      '/site-crawls/url-preview',
      input,
      options,
    );
    return strictValidate(urlPreviewResponseSchema, res, 'siteHealth.previewUrls');
  },
  listCrawls: async (params: CrawlListParams, options?: ApiRequestOptions) => {
    const path = withQuery('/site-crawls', definedQuery(params));
    const res = await apiClient.get<SiteCrawlListPage>(path, options);
    return strictValidate(siteCrawlListPageSchema, res, 'siteHealth.listCrawls');
  },
  getCrawl: async (crawlId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<SiteCrawl>(`/site-crawls/${crawlId}`, options);
    return strictValidate(siteCrawlSchema, res, 'siteHealth.getCrawl');
  },
  cancelCrawl: async (crawlId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<SiteCrawl>(
      `/site-crawls/${crawlId}/cancel`,
      undefined,
      options,
    );
    return strictValidate(siteCrawlSchema, res, 'siteHealth.cancelCrawl');
  },
  getInventory: async (crawlId: string, params?: InventoryParams, options?: ApiRequestOptions) => {
    const path = withQuery(`/site-crawls/${crawlId}/inventory`, definedQuery(params));
    const res = await apiClient.get<InventoryPage>(path, options);
    return strictValidate(inventoryPageSchema, res, 'siteHealth.getInventory');
  },
  getMonitoredUrls: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<MonitoredUrlsResponse>(
      `/projects/${projectId}/monitored-urls`,
      options,
    );
    return strictValidate(monitoredUrlsResponseSchema, res, 'siteHealth.getMonitoredUrls');
  },
  getPages: async (crawlId: string, params?: PagesParams, options?: ApiRequestOptions) => {
    const path = withQuery(`/site-crawls/${crawlId}/pages`, definedQuery(params));
    const res = await apiClient.get<PagesPage>(path, options);
    return strictValidate(pagesPageSchema, res, 'siteHealth.getPages');
  },
  getPage: async (crawlId: string, siteUrlId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PageDetail>(
      `/site-crawls/${crawlId}/pages/${siteUrlId}`,
      options,
    );
    return strictValidate(pageDetailSchema, res, 'siteHealth.getPage');
  },
  rerunPage: async (crawlId: string, siteUrlId: string, options?: ApiRequestOptions) => {
    // 202 Accepted carrying the (possibly fresh) rerun identity + status so
    // the client polls the new run — not the terminal source crawl.
    const res = await apiClient.post<RerunPageResponse>(
      `/site-crawls/${crawlId}/pages/${siteUrlId}/rerun`,
      undefined,
      options,
    );
    return strictValidate(rerunPageResponseSchema, res, 'siteHealth.rerunPage');
  },
  getIssues: async (crawlId: string, params?: IssuesParams, options?: ApiRequestOptions) => {
    const path = withQuery(`/site-crawls/${crawlId}/issues`, definedQuery(params));
    const res = await apiClient.get<SiteIssuesPage>(path, options);
    return strictValidate(siteIssuesPageSchema, res, 'siteHealth.getIssues');
  },
  getIssue: async (
    crawlId: string,
    groupId: string,
    params?: IssueDetailParams,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/site-crawls/${crawlId}/issues/${groupId}`, definedQuery(params));
    const res = await apiClient.get<SiteIssueDetail>(path, options);
    return strictValidate(siteIssueDetailSchema, res, 'siteHealth.getIssue');
  },
  getIssueHistory: async (
    crawlId: string,
    siteUrlId: string,
    params?: IssueHistoryParams,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(
      `/site-crawls/${crawlId}/pages/${siteUrlId}/issue-history`,
      definedQuery(params),
    );
    const res = await apiClient.get<IssueHistoryPage>(path, options);
    return strictValidate(issueHistoryPageSchema, res, 'siteHealth.getIssueHistory');
  },
  getDashboard: async (projectId: string, crawlId?: string, options?: ApiRequestOptions) => {
    const path = withQuery(
      `/projects/${projectId}/site-health`,
      definedQuery({ crawl_id: crawlId }),
    );
    const res = await apiClient.get<SiteHealthDashboard>(path, options);
    return strictValidate(siteHealthDashboardSchema, res, 'siteHealth.getDashboard');
  },
  getAeoReadiness: async (projectId: string, crawlId?: string, options?: ApiRequestOptions) => {
    const path = withQuery(
      `/projects/${projectId}/site-health/aeo-readiness`,
      definedQuery({ crawl_id: crawlId }),
    );
    const res = await apiClient.get<AeoReadiness>(path, options);
    return strictValidate(aeoReadinessSchema, res, 'siteHealth.getAeoReadiness');
  },
  getOverview: async (projectId: string, crawlId?: string, options?: ApiRequestOptions) => {
    const path = withQuery(
      `/projects/${projectId}/site-health/overview`,
      definedQuery({ crawl_id: crawlId }),
    );
    const res = await apiClient.get<SiteHealthOverview>(path, options);
    return strictValidate(siteHealthOverviewSchema, res, 'siteHealth.getOverview');
  },
  getArchitecture: async (projectId: string, crawlId?: string, options?: ApiRequestOptions) => {
    const path = withQuery(
      `/projects/${projectId}/site-health/architecture`,
      definedQuery({ crawl_id: crawlId }),
    );
    const res = await apiClient.get<SiteArchitecture>(path, options);
    return strictValidate(architectureSchema, res, 'siteHealth.getArchitecture');
  },
  getChangesSummary: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<ChangeSummary>(
      `/projects/${projectId}/site-health/changes/summary`,
      options,
    );
    return strictValidate(changeSummarySchema, res, 'siteHealth.getChangesSummary');
  },
  getChanges: async (
    projectId: string,
    crawlAId: string,
    crawlBId: string,
    cursor?: string,
    limit?: number,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(
      `/projects/${projectId}/site-health/changes`,
      definedQuery({ crawl_a_id: crawlAId, crawl_b_id: crawlBId, limit, cursor }),
    );
    const res = await apiClient.get<ChangesPage>(path, options);
    return strictValidate(changesPageSchema, res, 'siteHealth.getChanges');
  },
  /** Same-origin SSE endpoint (polling is the baseline; `?stream=true`). */
  eventsUrl: (crawlId: string) => `${API_BASE_URL}/site-crawls/${crawlId}/events?stream=true`,
  /** Same-origin export URLs (browser navigation / download links). */
  exportUrl: (
    crawlId: string,
    format: 'csv' | 'md',
    // `architecture` is a tree, so it renders as Markdown only; CSV rejects it.
    view?: 'inventory' | 'pages' | 'issues' | 'architecture',
  ) => {
    const base = `${API_BASE_URL}/site-crawls/${crawlId}/export.${format}`;
    return view ? `${base}?view=${view}` : base;
  },
};

/**
 * React Query option factories. Screens (Tasks 7/8) pass these straight to
 * `useQuery` / `useMutation`, so the query key ↔ endpoint pairing lives in one
 * place. Every `queryFn` forwards the abort signal.
 */
export const siteHealthQueries = {
  robotsHistory: (workspaceId: string, projectId: string, cursor?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.robotsHistory(workspaceId, projectId, cursor),
      // Opening history refreshes the project's observation sequence, irrespective of selected crawl.
      refetchOnMount: 'always',
      queryFn: ({ signal }) =>
        siteHealthApi.getRobotsHistory(projectId, cursor, { signal, workspaceId }),
    }),
  dashboard: (workspaceId: string, projectId: string, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.dashboard(projectId, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getDashboard(projectId, crawlId, { signal, workspaceId }),
    }),
  aeoReadiness: (workspaceId: string, projectId: string, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.aeoReadiness(projectId, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getAeoReadiness(projectId, crawlId, { signal, workspaceId }),
    }),
  overview: (workspaceId: string, projectId: string, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.overview(projectId, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getOverview(projectId, crawlId, { signal, workspaceId }),
    }),
  architecture: (workspaceId: string, projectId: string, crawlId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.architecture(projectId, crawlId),
      queryFn: ({ signal }) =>
        siteHealthApi.getArchitecture(projectId, crawlId, { signal, workspaceId }),
    }),
  changesSummary: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.changesSummary(projectId),
      queryFn: ({ signal }) => siteHealthApi.getChangesSummary(projectId, { signal, workspaceId }),
    }),
  changes: (
    workspaceId: string,
    projectId: string,
    crawlAId?: string,
    crawlBId?: string,
    cursor?: string,
    limit?: number,
  ) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.changes(projectId, crawlAId, crawlBId, cursor, limit),
      queryFn: ({ signal }) => {
        if (!crawlAId || !crawlBId) throw new Error('A persisted crawl pair is required');
        return siteHealthApi.getChanges(projectId, crawlAId, crawlBId, cursor, limit, {
          signal,
          workspaceId,
        });
      },
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(projectId, previousData, previousQuery),
    }),
  crawls: (workspaceId: string, params: CrawlListParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.crawls(params.project_id, {
        limit: params.limit ?? null,
        cursor: params.cursor ?? null,
      }),
      queryFn: ({ signal }) => siteHealthApi.listCrawls(params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(params.project_id, previousData, previousQuery),
    }),
  crawl: (workspaceId: string, crawlId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.crawl(crawlId),
      queryFn: ({ signal }) => siteHealthApi.getCrawl(crawlId, { signal, workspaceId }),
    }),
  inventory: (workspaceId: string, crawlId: string, params?: InventoryParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.inventory(crawlId, {
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
  monitored: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.monitored(projectId),
      queryFn: ({ signal }) => siteHealthApi.getMonitoredUrls(projectId, { signal, workspaceId }),
    }),
  pages: (workspaceId: string, crawlId: string, params?: PagesParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.pages(crawlId, {
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
  page: (workspaceId: string, crawlId: string, siteUrlId: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.page(crawlId, siteUrlId),
      queryFn: ({ signal }) => siteHealthApi.getPage(crawlId, siteUrlId, { signal, workspaceId }),
    }),
  issues: (workspaceId: string, crawlId: string, params?: IssuesParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issues(crawlId, {
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
      }),
      queryFn: ({ signal }) => siteHealthApi.getIssues(crawlId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
  issue: (workspaceId: string, crawlId: string, groupId: string, params?: IssueDetailParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issue(crawlId, groupId, {
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
    workspaceId: string,
    crawlId: string,
    siteUrlId: string,
    params?: IssueHistoryParams,
  ) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.issueHistory(crawlId, siteUrlId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
      }),
      queryFn: ({ signal }) =>
        siteHealthApi.getIssueHistory(crawlId, siteUrlId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        retainPreviousDataForScope(crawlId, previousData, previousQuery),
    }),
};

export const siteHealthMutations = {
  createCrawl: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (input: StartCrawlInput) => siteHealthApi.createCrawl(input, { workspaceId }),
    }),
  cancelCrawl: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (crawlId: string) => siteHealthApi.cancelCrawl(crawlId, { workspaceId }),
    }),
  rerunPage: (workspaceId: string) =>
    mutationOptions({
      mutationFn: (vars: { crawlId: string; siteUrlId: string }) =>
        siteHealthApi.rerunPage(vars.crawlId, vars.siteUrlId, { workspaceId }),
    }),
};
