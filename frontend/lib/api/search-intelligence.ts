import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';

import { apiClient, type ApiRequestOptions } from './client';
import { searchIntelligenceKeys } from './query-keys/search-intelligence';
import {
  researchScopeSchema,
  searchDatasetPageSchema,
  searchDatasetSchema,
  searchPreferencesSchema,
  searchReadinessSchema,
  searchRowSchema,
  searchRunSchema,
} from '@citeladder/contracts';
import { strictValidate } from '@citeladder/contracts/validation';

export type SearchIntelligenceReadiness = z.infer<typeof searchReadinessSchema>;
export type SearchIntelligenceRun = z.infer<typeof searchRunSchema>;
export type SearchIntelligenceDataset = z.infer<typeof searchDatasetSchema>;
export type SearchIntelligenceRow = z.infer<typeof searchRowSchema>;
export type ResearchScope = z.infer<typeof researchScopeSchema>;
export type DatasetSelection = {
  kind: string;
  competitor_id?: string | null;
  depth: number;
  seed?: string;
  grouping?: 'as_is' | 'one_per_domain';
  order?: 'volume' | 'traffic' | 'position' | 'difficulty' | 'cpc';
  min_volume?: number;
};
export type ReviewPayload = {
  research_scope?: ResearchScope;
  action: string;
  owned_target_id?: string | null;
  connection_id?: string | null;
  location_code?: number | null;
  language_code?: string;
  reuse_recent: boolean;
  save_as_defaults?: boolean;
  datasets: DatasetSelection[];
  previous_run_id?: string | null;
};

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
  review: async (projectId: string, payload: ReviewPayload, options?: ApiRequestOptions) =>
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
    backlinkDatasetId: string,
    auditIds: string[],
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      searchDatasetSchema,
      await apiClient.post<unknown>(
        `${root(projectId)}/citation-matches`,
        { backlink_dataset_id: backlinkDatasetId, audit_ids: auditIds },
        options,
      ),
      'searchIntelligence.deriveCitationMatches',
    ),
  savePreferences: async (
    projectId: string,
    payload: z.infer<typeof searchPreferencesSchema>,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      searchPreferencesSchema,
      await apiClient.put<unknown>(`${root(projectId)}/preferences`, payload, options),
      'searchIntelligence.savePreferences',
    ),
};

export const searchIntelligenceQueries = {
  /** What the screen can show and run; it gates the whole Search Intelligence screen. */
  readiness: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: searchIntelligenceKeys.readiness(workspaceId, projectId),
      queryFn: ({ signal }) => searchIntelligenceApi.readiness(projectId, { signal, workspaceId }),
    }),
  /**
   * One page of a saved dataset's rows, as a cursor table reads it: the rows
   * under `items`, beside the dataset whose filtered count is the table's total.
   */
  datasetRows: (
    workspaceId: string,
    projectId: string,
    datasetId: string,
    params: DatasetRowsParams,
  ) =>
    queryOptions({
      queryKey: [...searchIntelligenceKeys.dataset(workspaceId, projectId, datasetId), params],
      queryFn: async ({ signal }) => {
        const page = await searchIntelligenceApi.rows(
          projectId,
          datasetId,
          { signal, workspaceId },
          params,
        );
        return { dataset: page.dataset, items: page.rows, next_cursor: page.next_cursor };
      },
      // A failed interactive sort or filter settles promptly on the read
      // error instead of holding the previous rows through retries.
      retry: false,
    }),
};
