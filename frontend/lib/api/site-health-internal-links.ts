import { mutationOptions, queryOptions } from '@tanstack/react-query';
import {
  internalLinksReadSchema,
  type InternalLinksInput,
} from '@citeladder/contracts/site-health';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import { strictValidate } from '@citeladder/contracts/validation';
import { SITE_HEALTH_EXECUTION_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import { startInteractiveWork } from './interactive-work';

const root = (projectId: string) => `/projects/${projectId}/site-health/internal-links`;

const internalLinksApi = {
  async read(projectId: string, analysisId: string | undefined, options: ApiRequestOptions) {
    const path =
      root(projectId) + (analysisId ? `?analysis_id=${encodeURIComponent(analysisId)}` : '');
    return strictValidate(
      internalLinksReadSchema,
      await apiClient.get(path, options),
      'internalLinks.read',
    );
  },
  async analyze(projectId: string, input: InternalLinksInput, options: ApiRequestOptions) {
    const result = strictValidate(
      internalLinksReadSchema,
      await apiClient.post(`${root(projectId)}/analyses`, input, options),
      'internalLinks.analyze',
    );
    if (result.analysis?.state === 'queued' || result.analysis?.state === 'running')
      startInteractiveWork(`${root(projectId)}/analyses/${result.analysis.id}/run`, {
        ...options,
        timeoutMs: SITE_HEALTH_EXECUTION_REQUEST_TIMEOUT_MS,
      });
    return result;
  },
  async cancel(projectId: string, analysisId: string, options: ApiRequestOptions) {
    return strictValidate(
      internalLinksReadSchema,
      await apiClient.post(`${root(projectId)}/analyses/${analysisId}/cancel`, {}, options),
      'internalLinks.cancel',
    );
  },
};

const scoped = (scope: ProjectScope) => ({ workspaceId: scope.workspaceId });

export const internalLinksQueries = {
  /** One analysis of the project's internal links; without an id, the newest. */
  analysis: (scope: ProjectScope, analysisId?: string) =>
    queryOptions({
      queryKey: queryKeys.siteHealth.internalLinks(scope, analysisId),
      queryFn: ({ signal }) =>
        internalLinksApi.read(scope.projectId, analysisId, { ...scoped(scope), signal }),
    }),
};

/** Internal-link writes; each success writes or refreshes the reads it changes. */
export const internalLinksMutations = {
  /**
   * Start an analysis of a crawl. The newest-analysis read is marked stale
   * without a refetch (the caller moves to the new analysis), and the new
   * analysis's own entry is seeded so that move does not flash a reload.
   */
  analyze: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: InternalLinksInput) =>
        internalLinksApi.analyze(scope.projectId, input, scoped(scope)),
      onSuccess: (result, _input, _result, { client }) => {
        void client.invalidateQueries({
          queryKey: queryKeys.siteHealth.internalLinks(scope),
          exact: true,
          refetchType: 'none',
        });
        if (result.analysis)
          client.setQueryData(
            queryKeys.siteHealth.internalLinks(scope, result.analysis.id),
            result,
          );
      },
    }),
  /** Cancel an analysis; the answer replaces the read it was shown from. */
  cancel: (scope: ProjectScope, shownAnalysisId?: string) =>
    mutationOptions({
      mutationFn: (analysisId: string) =>
        internalLinksApi.cancel(scope.projectId, analysisId, scoped(scope)),
      onSuccess: (result, _analysisId, _result, { client }) =>
        client.setQueryData(queryKeys.siteHealth.internalLinks(scope, shownAnalysisId), result),
    }),
};
