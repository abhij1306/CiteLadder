/**
 * Site Health query-key namespace. Project reads sit on the shared scoped-key
 * builder (`['site-health', projectId, resource, workspaceId, ...]`), so one
 * project prefix refreshes every project read. A crawl's own reads are keyed
 * by the crawl, because a crawl page knows only its id: `['site-health',
 * 'crawl', crawlId, resource, workspaceId, ...]`, the workspace after the
 * resource so a crawl's prefix reaches every workspace's copy.
 */
import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const siteHealth = scopedKeys('site-health');

/** One resource of one crawl, in every workspace. */
const crawlResource = <const Resource extends string>(crawlId: string, resource: Resource) =>
  ['site-health', 'crawl', crawlId, resource] as const;
const crawlRead = <const Resource extends string, const Args extends readonly unknown[]>(
  resource: Resource,
  workspaceId: string | null,
  crawlId: string,
  ...args: Args
) => [...crawlResource(crawlId, resource), workspaceId, ...args] as const;

export const siteHealthKeys = {
  ...siteHealth,
  // A crawl id or `latest`: the dashboard and its tabs read either the
  // project's newest crawl or one the reader selected.
  dashboard: (scope: ProjectScope, crawlId?: string) =>
    siteHealth.read('dashboard', scope, crawlId ?? 'latest'),
  overview: (scope: ProjectScope, crawlId?: string) =>
    siteHealth.read('overview', scope, crawlId ?? 'latest'),
  aeoReadiness: (scope: ProjectScope, crawlId?: string) =>
    siteHealth.read('aeo-readiness', scope, crawlId ?? 'latest'),
  architecture: (scope: ProjectScope, crawlId?: string) =>
    siteHealth.read('architecture', scope, crawlId ?? 'latest'),
  changesSummary: (scope: ProjectScope) => siteHealth.read('changes-summary', scope),
  changes: (
    scope: ProjectScope,
    page: Readonly<{ crawlAId?: string; crawlBId?: string; cursor?: string; limit?: number }>,
  ) =>
    siteHealth.read(
      'changes',
      scope,
      page.crawlAId ?? 'unselected-a',
      page.crawlBId ?? 'unselected-b',
      page.cursor ?? 'first',
      page.limit ?? 'default',
    ),
  robotsHistory: (scope: ProjectScope, page: Readonly<{ cursor?: string; limit?: number }>) =>
    siteHealth.read('robots-history', scope, page.cursor ?? 'first', page.limit ?? null),
  crawls: (scope: ProjectScope, filters: ListFilters = {}) =>
    siteHealth.read('crawls', scope, filters),
  monitored: (scope: ProjectScope) => siteHealth.read('monitored', scope),
  crawlSchedule: (scope: ProjectScope) => siteHealth.read('crawl-schedule', scope),
  internalLinks: (scope: ProjectScope, analysisId?: string) =>
    siteHealth.read('internal-links', scope, analysisId ?? 'latest'),
  /**
   * The project-scoped read of the newest crawl's pages. Its answer names the
   * crawl, and the route prefetcher files it under that crawl's `pages` key.
   */
  latestCrawlPages: (scope: ProjectScope, filters: ListFilters = {}) =>
    siteHealth.read('latest-crawl-pages', scope, filters),
  /** The project-scoped read of the newest crawl's issues, as `latestCrawlPages`. */
  latestCrawlIssues: (scope: ProjectScope, filters: ListFilters = {}) =>
    siteHealth.read('latest-crawl-issues', scope, filters),

  /** The crawl row itself. */
  crawl: (workspaceId: string | null, crawlId: string) =>
    crawlRead('summary', workspaceId, crawlId),
  /** The crawl row, in every workspace. */
  crawlRow: (crawlId: string) => crawlResource(crawlId, 'summary'),
  // The paged reads keep their filters last: a first page is found by their
  // `cursor` (see `isFirstPage`).
  inventory: (workspaceId: string | null, crawlId: string, filters: ListFilters = {}) =>
    crawlRead('inventory', workspaceId, crawlId, filters),
  /** Every inventory page of one crawl, in any workspace and filter. */
  crawlInventory: (crawlId: string) => crawlResource(crawlId, 'inventory'),
  pages: (workspaceId: string | null, crawlId: string, filters: ListFilters = {}) =>
    crawlRead('pages', workspaceId, crawlId, filters),
  /** Every page-browser page of one crawl, in any workspace and filter. */
  crawlPages: (crawlId: string) => crawlResource(crawlId, 'pages'),
  issues: (workspaceId: string | null, crawlId: string, filters: ListFilters = {}) =>
    crawlRead('issues', workspaceId, crawlId, filters),
  /** Every issues page of one crawl, in any workspace and filter. */
  crawlIssues: (crawlId: string) => crawlResource(crawlId, 'issues'),
  issue: (
    workspaceId: string | null,
    crawlId: string,
    groupId: string,
    filters: ListFilters = {},
  ) => crawlRead('issue', workspaceId, crawlId, groupId, filters),
  /** Every issue's detail pages of one crawl, in any workspace and filter. */
  crawlIssueDetails: (crawlId: string) => crawlResource(crawlId, 'issue'),
  /** The crawl's fix progress, in every workspace. */
  crawlIssueFixes: (crawlId: string) => crawlResource(crawlId, 'issue-fixes'),
  /** How far each of the crawl's issues is fixed: what Mark fixed and every audit move. */
  issueFixes: (workspaceId: string | null, crawlId: string) =>
    crawlRead('issue-fixes', workspaceId, crawlId),
  /** One URL's detail, in every workspace: what a rerun refreshes. */
  crawlPage: (crawlId: string, siteUrlId: string) =>
    [...crawlResource(crawlId, 'page'), siteUrlId] as const,
  page: (workspaceId: string | null, crawlId: string, siteUrlId: string) =>
    [...crawlResource(crawlId, 'page'), siteUrlId, workspaceId] as const,
  issueHistory: (
    workspaceId: string | null,
    crawlId: string,
    siteUrlId: string,
    filters: ListFilters = {},
  ) => crawlRead('issue-history', workspaceId, crawlId, siteUrlId, filters),
  /**
   * True for a paged crawl read sitting on its FIRST page. The filters are the
   * last segment of every paged key above and carry an explicit `cursor: null`
   * for a first page; this module builds those keys, so it is the one place
   * that reads them.
   */
  isFirstPage: (queryKey: readonly unknown[]): boolean => {
    const filters = queryKey.at(-1);
    if (typeof filters !== 'object' || filters === null) return true;
    return (filters as { cursor?: unknown }).cursor == null;
  },
};
