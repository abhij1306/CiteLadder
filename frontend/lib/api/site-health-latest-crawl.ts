/**
 * The project-scoped Site Health reads of the newest crawl's pages and issues.
 *
 * The screens read pages and issues per crawl, and only the dashboard names the
 * crawl. These answer the same reads for the project's newest crawl (the one
 * the dashboard shows) and name it, so the route prefetchers can start them
 * beside the dashboard and file each answer under that crawl's key.
 */
import {
  latestCrawlIssuesPageSchema,
  latestCrawlPagesPageSchema,
} from '@citeladder/contracts/site-health';
import { strictValidate } from '@citeladder/contracts/validation';

import { apiClient, type ApiRequestOptions } from './client';
import { definedQuery, withQuery } from './shared';
import type { IssuesParams, PagesParams } from './site-health';

export const latestCrawlApi = {
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
