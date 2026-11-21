import { isRecord } from '@/lib/utils';
import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const siteHealth = scopedKeys('site-health');

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
  latestCrawlPages: (scope: ProjectScope, filters: ListFilters = {}) =>
    siteHealth.read('latest-crawl-pages', scope, filters),
  latestCrawlIssues: (scope: ProjectScope, filters: ListFilters = {}) =>
    siteHealth.read('latest-crawl-issues', scope, filters),

  crawl: (workspaceId: string | null, crawlId: string) =>
    crawlRead('summary', workspaceId, crawlId),
  crawlRow: (crawlId: string) => crawlResource(crawlId, 'summary'),
  inventory: (workspaceId: string | null, crawlId: string, filters: ListFilters = {}) =>
    crawlRead('inventory', workspaceId, crawlId, filters),
  crawlInventory: (crawlId: string) => crawlResource(crawlId, 'inventory'),
  pages: (workspaceId: string | null, crawlId: string, filters: ListFilters = {}) =>
    crawlRead('pages', workspaceId, crawlId, filters),
  crawlPages: (crawlId: string) => crawlResource(crawlId, 'pages'),
  issues: (workspaceId: string | null, crawlId: string, filters: ListFilters = {}) =>
    crawlRead('issues', workspaceId, crawlId, filters),
  crawlIssues: (crawlId: string) => crawlResource(crawlId, 'issues'),
  issue: (
    workspaceId: string | null,
    crawlId: string,
    groupId: string,
    filters: ListFilters = {},
  ) => crawlRead('issue', workspaceId, crawlId, groupId, filters),
  crawlIssueDetails: (crawlId: string) => crawlResource(crawlId, 'issue'),
  crawlIssueFixes: (crawlId: string) => crawlResource(crawlId, 'issue-fixes'),
  issueFixes: (workspaceId: string | null, crawlId: string) =>
    crawlRead('issue-fixes', workspaceId, crawlId),
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
  isFirstPage: (queryKey: readonly unknown[]): boolean => {
    const filters = queryKey.at(-1);
    return !isRecord(filters) || filters.cursor == null;
  },
};
