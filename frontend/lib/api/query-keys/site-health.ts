/**
 * Site Health query-key namespace — isolated by project / crawl / filter so an
 * inventory query for one crawl (or one filter combination) never collides
 * with another.
 */
import type { ListFilters } from './shared';

export const siteHealthKeys = {
  /** The project at index 2, so a page turn keeps its rows only inside it. */
  robotsHistory: (
    workspaceId: string,
    projectId: string,
    page: Readonly<{ cursor?: string; limit?: number }>,
  ) =>
    [
      'site-health',
      'robots-history',
      projectId,
      workspaceId,
      page.cursor ?? 'first',
      page.limit ?? null,
    ] as const,
  internalLinks: (workspaceId: string, projectId: string, analysisId?: string) =>
    ['site-health', 'internal-links', workspaceId, projectId, analysisId ?? 'latest'] as const,
  all: ['site-health'] as const,
  dashboard: (projectId: string, crawlId?: string) =>
    ['site-health', 'dashboard', projectId, crawlId ?? 'latest'] as const,
  overview: (projectId: string, crawlId?: string) =>
    ['site-health', 'overview', projectId, crawlId ?? 'latest'] as const,
  aeoReadiness: (projectId: string, crawlId?: string) =>
    ['site-health', 'aeo-readiness', projectId, crawlId ?? 'latest'] as const,
  architecture: (projectId: string, crawlId?: string) =>
    ['site-health', 'architecture', projectId, crawlId ?? 'latest'] as const,
  changes: (
    workspaceId: string,
    projectId: string,
    page: Readonly<{ crawlAId?: string; crawlBId?: string; cursor?: string; limit?: number }>,
  ) =>
    [
      'site-health',
      'changes',
      projectId,
      workspaceId,
      page.crawlAId ?? 'unselected-a',
      page.crawlBId ?? 'unselected-b',
      page.cursor ?? 'first',
      page.limit ?? 'default',
    ] as const,
  changesSummary: (projectId: string) => ['site-health', 'changes-summary', projectId] as const,
  crawls: (projectId: string, filters: ListFilters = {}) =>
    ['site-health', 'crawls', projectId, filters] as const,
  crawl: (crawlId: string) => ['site-health', 'crawl', crawlId] as const,
  // A cursor table keeps its rows across a page turn only inside the
  // workspace its key names, so these paged reads hold it before the filters
  // (which stay last: a first page is found by their `cursor`).
  inventory: (crawlId: string, workspaceId: string, filters: ListFilters = {}) =>
    ['site-health', 'inventory', crawlId, workspaceId, filters] as const,
  /** Every inventory page of one crawl, in any workspace and filter. */
  crawlInventory: (crawlId: string) => ['site-health', 'inventory', crawlId] as const,
  monitored: (projectId: string) => ['site-health', 'monitored', projectId] as const,
  pages: (crawlId: string, workspaceId: string, filters: ListFilters = {}) =>
    ['site-health', 'pages', crawlId, workspaceId, filters] as const,
  /** Every page-browser page of one crawl, in any workspace and filter. */
  crawlPages: (crawlId: string) => ['site-health', 'pages', crawlId] as const,
  /**
   * The project-scoped read of the newest crawl's pages. Its answer names the
   * crawl, and the route prefetcher files it under that crawl's `pages` key.
   */
  latestCrawlPages: (workspaceId: string, projectId: string, filters: ListFilters = {}) =>
    ['site-health', 'latest-crawl-pages', projectId, workspaceId, filters] as const,
  /** The project-scoped read of the newest crawl's issues, as `latestCrawlPages`. */
  latestCrawlIssues: (workspaceId: string, projectId: string, filters: ListFilters = {}) =>
    ['site-health', 'latest-crawl-issues', projectId, workspaceId, filters] as const,
  page: (crawlId: string, siteUrlId: string) =>
    ['site-health', 'page', crawlId, siteUrlId] as const,
  issueHistory: (
    crawlId: string,
    siteUrlId: string,
    workspaceId: string,
    filters: ListFilters = {},
  ) => ['site-health', 'issue-history', crawlId, siteUrlId, workspaceId, filters] as const,
  issues: (crawlId: string, filters: ListFilters = {}) =>
    ['site-health', 'issues', crawlId, filters] as const,
  issue: (crawlId: string, groupId: string, filters: ListFilters = {}) =>
    ['site-health', 'issue', crawlId, groupId, filters] as const,
};
