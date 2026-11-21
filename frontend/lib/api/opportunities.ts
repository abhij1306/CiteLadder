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

import { apiClient, type ApiRequestOptions } from './client';
import {
  opportunitiesPageSchema,
  opportunityOrderResponseSchema,
  type OpportunityOrderUpdateRequest,
} from '@citeladder/contracts/opportunities';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import type { OpportunitiesPage } from '@citeladder/contracts';

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
  updateOrder: async (
    projectId: string,
    input: OpportunityOrderUpdateRequest,
    options?: ApiRequestOptions,
  ) => {
    const res = await apiClient.put(`/projects/${projectId}/opportunities/order`, input, options);
    return strictValidate(opportunityOrderResponseSchema, res, 'opportunities.updateOrder');
  },
};
