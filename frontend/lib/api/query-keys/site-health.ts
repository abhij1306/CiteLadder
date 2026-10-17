/**
 * Site Health query-key namespace — isolated by project / crawl / filter so an
 * inventory query for one crawl (or one filter combination) never collides
 * with another.
 */
import type { ListFilters } from './shared';

export const siteHealthKeys = {
  robotsHistory: (workspaceId: string, projectId: string, cursor?: string) =>
    ['site-health', 'robots-history', workspaceId, projectId, cursor ?? 'first'] as const,
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
    projectId: string,
    crawlAId?: string,
    crawlBId?: string,
    cursor?: string,
    limit?: number,
  ) =>
    [
      'site-health',
      'changes',
      projectId,
      crawlAId ?? 'unselected-a',
      crawlBId ?? 'unselected-b',
      cursor ?? 'first',
      limit ?? 'default',
    ] as const,
  changesSummary: (projectId: string) => ['site-health', 'changes-summary', projectId] as const,
  crawls: (projectId: string, filters: ListFilters = {}) =>
    ['site-health', 'crawls', projectId, filters] as const,
  crawl: (crawlId: string) => ['site-health', 'crawl', crawlId] as const,
  inventory: (crawlId: string, filters: ListFilters = {}) =>
    ['site-health', 'inventory', crawlId, filters] as const,
  monitored: (projectId: string) => ['site-health', 'monitored', projectId] as const,
  pages: (crawlId: string, filters: ListFilters = {}) =>
    ['site-health', 'pages', crawlId, filters] as const,
  page: (crawlId: string, siteUrlId: string) =>
    ['site-health', 'page', crawlId, siteUrlId] as const,
  issueHistory: (crawlId: string, siteUrlId: string, filters: ListFilters = {}) =>
    ['site-health', 'issue-history', crawlId, siteUrlId, filters] as const,
  issues: (crawlId: string, filters: ListFilters = {}) =>
    ['site-health', 'issues', crawlId, filters] as const,
  issue: (crawlId: string, groupId: string, filters: ListFilters = {}) =>
    ['site-health', 'issue', crawlId, groupId, filters] as const,
};
