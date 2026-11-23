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
import { API_BASE_URL } from '@/lib/config/operational';
import { apiClient, type ApiRequestOptions } from './client';
import type { queryKeys } from './query-keys';
import {
  aeoReadinessSchema,
  architectureSchema,
  changeSummarySchema,
  changesPageSchema,
  crawlScheduleSchema,
  inventoryPageSchema,
  issueFixesSchema,
  issueFixProgressSchema,
  issueHistoryPageSchema,
  issueRerunResponseSchema,
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
  robotsHistoryPageSchema,
} from '@citeladder/contracts/site-health';
import type {
  CrawlScheduleUpdateRequest,
  SiteCrawlCreateRequest,
} from '@citeladder/contracts/site-health-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import type {
  AeoReadiness,
  ChangeSummary,
  ChangesPage,
  CrawlSchedule,
  InventoryPage,
  IssueFixes,
  IssueFixProgress,
  IssueHistoryPage,
  IssueRerunResponse,
  IssueSection,
  IssueSort,
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
} from '@citeladder/contracts';

export type StartCrawlInput = SiteCrawlCreateRequest;

export type InventoryParams = {
  cursor?: string;
  limit?: number;
  query?: string;
  status?: string;
  monitored?: boolean;
  page_kind?: string;
};

export type CrawlListParams = { project_id: string; limit?: number; cursor?: string };
export type PagesSort = 'status' | 'url' | 'inbound' | 'main_content_inbound' | 'depth';
export type PageScoreRole = 'web_fundamentals' | 'aeo_readiness';
export type PageFilterParams = {
  status?: string;
  monitored?: boolean;
  page_kind?: string;
  query?: string;
  sort?: PagesSort;
  rule?: string;
  with_issues?: boolean;
  indexable?: boolean;
  min_depth?: number;
  max_depth?: number;
  score_role?: PageScoreRole;
  max_score?: number;
};
export type PagesParams = PageFilterParams & { cursor?: string; limit?: number };
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
  page_kind?: string;
  section?: IssueSection;
  sort?: IssueSort;
};

export type IssueExportParams = Omit<IssuesParams, 'cursor' | 'limit'>;
export type ExportFilters = PageFilterParams | IssueExportParams | { group_id: string };
export type ExportFormat = 'csv' | 'md';
export type ExportView = 'pages' | 'issues' | 'issue';

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
  createCrawl: async (input: StartCrawlInput, options?: ApiRequestOptions) => {
    const res = await apiClient.post<SiteCrawl>('/site-crawls', input, options);
    return strictValidate(siteCrawlSchema, res, 'siteHealth.createCrawl');
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
  getCrawlSchedule: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<CrawlSchedule>(
      `/projects/${projectId}/crawl-schedule`,
      options,
    );
    return strictValidate(crawlScheduleSchema, res, 'siteHealth.getCrawlSchedule');
  },
  updateCrawlSchedule: async (
    projectId: string,
    input: CrawlScheduleUpdateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put<CrawlSchedule>(
      `/projects/${projectId}/crawl-schedule`,
      input,
      options,
    );
    return strictValidate(crawlScheduleSchema, res, 'siteHealth.updateCrawlSchedule');
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
  getIssueFixes: async (crawlId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<IssueFixes>(`/site-crawls/${crawlId}/issue-fixes`, options);
    return strictValidate(issueFixesSchema, res, 'siteHealth.getIssueFixes');
  },
  markIssueFixed: async (crawlId: string, groupId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<IssueFixProgress>(
      `/site-crawls/${crawlId}/issues/${groupId}/mark-fixed`,
      undefined,
      options,
    );
    return strictValidate(issueFixProgressSchema, res, 'siteHealth.markIssueFixed');
  },
  rerunIssue: async (crawlId: string, groupId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<IssueRerunResponse>(
      `/site-crawls/${crawlId}/issues/${groupId}/rerun`,
      undefined,
      options,
    );
    return strictValidate(issueRerunResponseSchema, res, 'siteHealth.rerunIssue');
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
  eventsUrl: (crawlId: string) => `${API_BASE_URL}/site-crawls/${crawlId}/events?stream=true`,
  exportUrl: (
    crawlId: string,
    format: ExportFormat,
    view: ExportView,
    filters: ExportFilters = {},
  ) =>
    withQuery(
      `${API_BASE_URL}/site-crawls/${crawlId}/export.${format}`,
      definedQuery({ view, ...filters }),
    ),
};
