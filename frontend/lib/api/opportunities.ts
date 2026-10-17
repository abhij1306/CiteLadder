/**
 * Opportunities domain endpoints + query/mutation options.
 *
 * Owns transport for the Opportunities slice: the priority-sorted keyset
 * catalog, the row detail and the shared queue order. Workflow status and implementation declarations belong to Actions
 * (`lib/api/actions.ts`). Every JSON response passes through `strictValidate`
 * (fail loud on any drift — the backend is the source of truth). All paths are relative
 * `/api/v1` (same-origin proxy) and every read accepts an
 * `AbortSignal` via `ApiRequestOptions`.
 */
import { queryOptions } from '@tanstack/react-query';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import {
  opportunitiesPageSchema,
  opportunityDetailSchema,
  opportunityOrderResponseSchema,
} from '@citeladder/contracts/opportunities';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import type { OpportunitiesPage, OpportunityDetail } from './types';

/** Keyset catalog params. Ordering is server-owned (priority desc, id desc). */
export type OpportunitiesParams = {
  cursor?: string;
  limit?: number;
  type?: string;
  severity?: string;
  status?: string;
  rule_id?: string;
  min_priority?: number;
};

export type OpportunityOrderUpdate = {
  ordered_opportunity_ids: string[];
  expected_version: number;
};

export const opportunitiesApi = {
  list: async (projectId: string, params?: OpportunitiesParams, options?: ApiRequestOptions) => {
    const path = withQuery(`/projects/${projectId}/opportunities`, definedQuery(params));
    const res = await apiClient.get<OpportunitiesPage>(path, options);
    return strictValidate(opportunitiesPageSchema, res, 'opportunities.list');
  },
  get: async (opportunityId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<OpportunityDetail>(`/opportunities/${opportunityId}`, options);
    return strictValidate(opportunityDetailSchema, res, 'opportunities.get');
  },
  updateOrder: async (
    projectId: string,
    input: OpportunityOrderUpdate,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put(`/projects/${projectId}/opportunities/order`, input, options);
    return strictValidate(opportunityOrderResponseSchema, res, 'opportunities.updateOrder');
  },
};

function extractProjectId(queryKey: readonly unknown[] | undefined): string | undefined {
  if (queryKey?.[0] !== 'opportunities') return undefined;
  if (queryKey[1] === 'list') {
    return typeof queryKey[2] === 'string' ? queryKey[2] : undefined;
  }
  return undefined;
}

function isSameProjectQuery(
  previousQuery: { queryKey: readonly unknown[] } | undefined,
  projectId: string,
): boolean {
  return extractProjectId(previousQuery?.queryKey) === projectId;
}

/**
 * React Query option factories. The query key ↔ endpoint pairing lives here
 * so screens pass these straight to `useQuery` / `useMutation`. Every
 * `queryFn` forwards the abort signal.
 */
export const opportunitiesQueries = {
  list: (workspaceId: string, projectId: string, params?: OpportunitiesParams) =>
    queryOptions({
      queryKey: queryKeys.opportunities.list(projectId, {
        cursor: params?.cursor ?? null,
        limit: params?.limit ?? null,
        type: params?.type ?? null,
        severity: params?.severity ?? null,
        status: params?.status ?? null,
        rule_id: params?.rule_id ?? null,
        min_priority: params?.min_priority ?? null,
      }),
      queryFn: ({ signal }) => opportunitiesApi.list(projectId, params, { signal, workspaceId }),
      placeholderData: (previousData, previousQuery) =>
        isSameProjectQuery(previousQuery, projectId) ? previousData : undefined,
    }),
  detail: (workspaceId: string, opportunityId: string) =>
    queryOptions({
      queryKey: queryKeys.opportunities.detail(opportunityId),
      queryFn: ({ signal }) => opportunitiesApi.get(opportunityId, { signal, workspaceId }),
    }),
};
