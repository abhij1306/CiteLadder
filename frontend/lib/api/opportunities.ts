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
  type OpportunityOrderUpdateRequest,
} from '@citeladder/contracts/opportunities';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import type { OpportunitiesPage, OpportunityDetail } from '@citeladder/contracts';

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
    input: OpportunityOrderUpdateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put(`/projects/${projectId}/opportunities/order`, input, options);
    return strictValidate(opportunityOrderResponseSchema, res, 'opportunities.updateOrder');
  },
};

/**
 * Opportunity reads. Screens reach the catalog through Actions and the
 * command center, so the browser reads one Opportunity: the evidence drawer's.
 */
export const opportunitiesQueries = {
  detail: (workspaceId: string | null, opportunityId: string) =>
    queryOptions({
      queryKey: queryKeys.opportunities.detail(workspaceId, opportunityId),
      queryFn: ({ signal }) => opportunitiesApi.get(opportunityId, { signal, workspaceId }),
    }),
};
