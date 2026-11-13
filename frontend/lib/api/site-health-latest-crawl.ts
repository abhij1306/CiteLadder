/**
 * The project-scoped Site Health reads of the current crawl's pages and issues.
 *
 * The screens read pages and issues per crawl, and only the dashboard names the
 * crawl. These answer the same reads for the project's current crawl (the one
 * the dashboard shows unless a crawl is running) and name it, so the route
 * prefetchers can start them beside the dashboard and file each answer under
 * that crawl's key. They are
 * read only through `latestCrawlQueries`, so the cache dedupes them.
 */
import {
  latestCrawlIssuesPageSchema,
  latestCrawlPagesPageSchema,
} from '@citeladder/contracts/site-health';
import { strictValidate } from '@citeladder/contracts/validation';
import { queryOptions } from '@tanstack/react-query';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import { definedQuery, withQuery } from './shared';
import type { IssuesParams, PagesParams } from './site-health';

const latestCrawlApi = {
  issues: async (projectId: string, params: IssuesParams, options?: ApiRequestOptions) => {
    const path = withQuery(`/projects/${projectId}/site-health/issues`, definedQuery(params));
    const res = await apiClient.get(path, options);
    return strictValidate(latestCrawlIssuesPageSchema, res, 'siteHealth.latestCrawlIssues');
  },
  pages: async (projectId: string, params: PagesParams, options?: ApiRequestOptions) => {
    const path = withQuery(`/projects/${projectId}/site-health/pages`, definedQuery(params));
    const res = await apiClient.get(path, options);
    return strictValidate(latestCrawlPagesPageSchema, res, 'siteHealth.latestCrawlPages');
  },
};

/**
 * The same reads as cache entries, so repeated intent (a hover, then a focus,
 * then a cold landing) joins one request instead of asking again. No screen
 * reads these keys: the prefetchers file each answer under its crawl's key.
 */
export const latestCrawlQueries = {
  pages: (scope: ProjectScope, params: PagesParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.latestCrawlPages(scope, params),
      queryFn: ({ signal }) =>
        latestCrawlApi.pages(scope.projectId, params, { signal, workspaceId: scope.workspaceId }),
    }),
  issues: (scope: ProjectScope, params: IssuesParams) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.latestCrawlIssues(scope, params),
      queryFn: ({ signal }) =>
        latestCrawlApi.issues(scope.projectId, params, { signal, workspaceId: scope.workspaceId }),
    }),
};
