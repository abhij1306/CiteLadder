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
