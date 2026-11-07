/**
 * Site Health domain endpoints (F2); its query and mutation descriptors live in
 * `site-health-queries.ts`.
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
import { API_BASE_URL, SITE_HEALTH_EXECUTION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { startInteractiveWork } from './interactive-work';
import { apiClient, type ApiRequestOptions } from './client';
import type { queryKeys } from './query-keys';
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
import type {
  SiteCrawlCreateRequest,
  UrlPreviewRequest,
} from '@citeladder/contracts/site-health-requests';
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
} from '@citeladder/contracts';

/**
 * A new crawl, or with `recrawl_of` a rerun of that crawl's frozen scope and
 * settings. `recrawl_of` picks the route; it is never part of the body.
 */
export type StartCrawlInput = SiteCrawlCreateRequest & { recrawl_of?: string };

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

export type CrawlListParams = { project_id: string; limit?: number; cursor?: string };
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
export type ChangesPageRequest = Parameters<typeof queryKeys.siteHealth.changes>[1];
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
  page_kind?: string; // v2 P1: issues affecting one classified page type
  detail_limit?: number; // embeds the first row's detail as `first_issue`
};

/** Keyset params for a grouped issue's affected-URL page and a URL's issue history. */
export type IssueDetailParams = Pick<IssuesParams, 'cursor' | 'limit' | 'page_kind'>;
export type IssueHistoryParams = Pick<IssuesParams, 'cursor' | 'limit'>;
export type RobotsPage = Pick<IssuesParams, 'cursor' | 'limit'>;

export const siteHealthApi = {
  getRobotsHistory: async (projectId: string, page: RobotsPage, options?: ApiRequestOptions) => {
    const res = await apiClient.get(
      withQuery(`/projects/${projectId}/site-health/robots-history`, definedQuery(page)),
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
  previewUrls: async (input: UrlPreviewRequest, options?: ApiRequestOptions) => {
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
