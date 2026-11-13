import { z } from 'zod';
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  researchScopeSchema,
  searchDatasetPageSchema,
  searchDatasetSchema,
  searchReadinessSchema,
  searchRowSchema,
  searchRunSchema,
} from '@citeladder/contracts';
import type {
  SearchCitationMatchRequest,
  SearchReviewRequest,
} from '@citeladder/contracts/search-intelligence-requests';
import { strictValidate } from '@citeladder/contracts/validation';

export type SearchIntelligenceReadiness = z.infer<typeof searchReadinessSchema>;
export type SearchIntelligenceRun = z.infer<typeof searchRunSchema>;
export type SearchIntelligenceDataset = z.infer<typeof searchDatasetSchema>;
export type SearchIntelligenceRow = z.infer<typeof searchRowSchema>;
export type ResearchScope = z.infer<typeof researchScopeSchema>;

/** One page of a saved dataset's rows: its order, filters and cursor. */
export type DatasetRowsParams = Readonly<{
  cursor?: string;
  limit?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
  search?: string;
  min_volume?: number;
  intent?: string;
}>;

const root = (projectId: string) => `/projects/${projectId}/search-intelligence`;
export const searchIntelligenceApi = {
  readiness: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      searchReadinessSchema,
      await apiClient.get<unknown>(root(projectId), options),
      'searchIntelligence.readiness',
    ),
  review: async (projectId: string, payload: SearchReviewRequest, options?: ApiRequestOptions) =>
    strictValidate(
      searchRunSchema,
      await apiClient.post<unknown>(`${root(projectId)}/reviews`, payload, {
        ...options,
        idempotencyKey: options?.idempotencyKey ?? `si-review:${globalThis.crypto.randomUUID()}`,
      }),
      'searchIntelligence.review',
    ),
  confirm: async (projectId: string, runId: string, options?: ApiRequestOptions) =>
    strictValidate(
      searchRunSchema,
      await apiClient.post<unknown>(`${root(projectId)}/runs/${runId}/confirm`, {}, options),
      'searchIntelligence.confirm',
    ),
  cancel: async (projectId: string, runId: string, options?: ApiRequestOptions) =>
    strictValidate(
      searchRunSchema,
      await apiClient.post<unknown>(`${root(projectId)}/runs/${runId}/cancel`, {}, options),
      'searchIntelligence.cancel',
    ),
  runs: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      z.array(searchRunSchema),
      await apiClient.get<unknown>(`${root(projectId)}/runs`, options),
      'searchIntelligence.runs',
    ),
  rows: async (
    projectId: string,
    datasetId: string,
    options?: ApiRequestOptions,
    params: DatasetRowsParams = {},
  ) => {
    const query = new URLSearchParams({ limit: String(params.limit ?? 200) });
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.sort) query.set('sort', params.sort);
    if (params.direction) query.set('direction', params.direction);
    if (params.search) query.set('search', params.search);
    if (params.min_volume !== undefined) query.set('min_volume', String(params.min_volume));
    if (params.intent) query.set('intent', params.intent);
    return strictValidate(
      searchDatasetPageSchema,
      await apiClient.get<unknown>(
        `${root(projectId)}/datasets/${datasetId}/rows?${query}`,
        options,
      ),
      'searchIntelligence.rows',
    );
  },
  deriveCitationMatches: async (
    projectId: string,
    input: SearchCitationMatchRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      searchDatasetSchema,
      await apiClient.post<unknown>(`${root(projectId)}/citation-matches`, input, options),
      'searchIntelligence.deriveCitationMatches',
    ),
};

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

/** The most rows one read of a saved dataset returns; a history chart reads one page. */
const DATASET_PAGE_LIMIT = 200;

export const searchIntelligenceQueries = {
  /** What the screen can show and run; it gates the whole Search Intelligence screen. */
  readiness: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.searchIntelligence.readiness(scope),
      queryFn: ({ signal }) =>
        searchIntelligenceApi.readiness(scope.projectId, scoped(scope, signal)),
    }),
  /** The project's research runs and their costs. */
  runs: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.searchIntelligence.runs(scope),
      queryFn: ({ signal }) => searchIntelligenceApi.runs(scope.projectId, scoped(scope, signal)),
    }),
  /**
   * One page of a saved dataset's rows, as a cursor table reads it: the rows
   * under `items`, beside the dataset whose filtered count is the table's total.
   */
  datasetRows: (scope: ProjectScope, datasetId: string, params: DatasetRowsParams) =>
    queryOptions({
      queryKey: queryKeys.searchIntelligence.datasetRows(scope, datasetId, params),
      queryFn: async ({ signal }) => {
        const page = await searchIntelligenceApi.rows(
          scope.projectId,
          datasetId,
          scoped(scope, signal),
          params,
        );
        return { dataset: page.dataset, items: page.rows, next_cursor: page.next_cursor };
      },
      // A failed interactive sort or filter settles promptly on the read
      // error instead of holding the previous rows through retries.
      retry: false,
    }),
  /** A saved dataset's history, read as one page for its chart. */
  datasetHistory: (scope: ProjectScope, datasetId: string) =>
    queryOptions({
      queryKey: queryKeys.searchIntelligence.datasetHistory(scope, datasetId),
      queryFn: ({ signal }) =>
        searchIntelligenceApi.rows(scope.projectId, datasetId, scoped(scope, signal), {
          limit: DATASET_PAGE_LIMIT,
        }),
    }),
};

/**
 * The project's readiness: its runs' state and every saved dataset. A
 * settled, cancelled or derived run changes it.
 */
const refreshSearchReadiness = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({
    queryKey: queryKeys.searchIntelligence.resource(projectId, 'readiness'),
  });

const refreshSearchRuns = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.searchIntelligence.resource(projectId, 'runs') });

/** Search Intelligence writes; each success refreshes every read it changes. */
export const searchIntelligenceMutations = {
  /** Price a run for review; nothing is written until it is confirmed. */
  review: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (payload: SearchReviewRequest) =>
        searchIntelligenceApi.review(scope.projectId, payload, scoped(scope)),
    }),
  /** Start a reviewed run: the readiness gains it, and the cost list its charge. */
  confirm: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (runId: string) =>
        searchIntelligenceApi.confirm(scope.projectId, runId, scoped(scope)),
      onSuccess: (_run, _runId, _result, { client }) =>
        Promise.all([
          refreshSearchReadiness(client, scope.projectId),
          refreshSearchRuns(client, scope.projectId),
        ]),
    }),
  /** A refused cancel (the run already settled) also leaves the readiness stale. */
  cancel: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (runId: string) =>
        searchIntelligenceApi.cancel(scope.projectId, runId, scoped(scope)),
      onSettled: (_run, _error, _runId, _result, { client }) =>
        refreshSearchReadiness(client, scope.projectId),
    }),
  /** Citation matches are saved as a new dataset, which the readiness lists. */
  deriveCitationMatches: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (input: SearchCitationMatchRequest) =>
        searchIntelligenceApi.deriveCitationMatches(scope.projectId, input, scoped(scope)),
      onSuccess: (_dataset, _input, _result, { client }) =>
        refreshSearchReadiness(client, scope.projectId),
    }),
};
