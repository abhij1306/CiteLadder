import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import { ONBOARDING_RESEARCH_REQUEST_TIMEOUT_MS } from '@/lib/config/operational';
import type {
  BrandDiscoveryCompleteRequest,
  BrandDiscoveryCreateRequest,
} from '@citeladder/contracts/brand-discovery-requests';
import { strictValidate } from '@citeladder/contracts/validation';
import {
  brandDiscoveryCatalogSchema,
  brandDiscoveryCompleteSchema,
  brandDiscoverySchema,
} from '@citeladder/contracts/visibility';

export type BrandDiscovery = z.infer<typeof brandDiscoverySchema>;

/**
 * The resolved business context. `category` and `category_terms` are open
 * vocabulary and decide what the generated questions are about; the rest are
 * closed facets that select which kinds of question apply.
 */
export type DiscoveryProfile = BrandDiscovery['profile'];

export const brandDiscoveriesApi = {
  catalog: async (options?: ApiRequestOptions) => {
    const value = await apiClient.get('/brand-discovery-catalog', options);
    return strictValidate(brandDiscoveryCatalogSchema, value, 'brandDiscovery.catalog');
  },
  // A discovery — and the project it becomes — belongs to ONE workspace, so
  // every call names the workspace it is for rather than inheriting whichever
  // one happened to be selected when the request was retried.
  create: async (
    input: BrandDiscoveryCreateRequest,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) => {
    const value = await apiClient.post('/brand-discoveries', input, {
      ...options,
      idempotencyKey,
      retryNetworkFailures: true,
    });
    return strictValidate(brandDiscoverySchema, value, 'brandDiscovery.create');
  },
  get: async (id: string, options?: ApiRequestOptions) => {
    const value = await apiClient.get(`/brand-discoveries/${id}`, options);
    return strictValidate(brandDiscoverySchema, value, 'brandDiscovery.get');
  },
  run: async (id: string, options?: ApiRequestOptions) => {
    const value = await apiClient.post(`/brand-discoveries/${id}/run`, undefined, {
      ...options,
      timeoutMs: ONBOARDING_RESEARCH_REQUEST_TIMEOUT_MS,
    });
    return strictValidate(brandDiscoverySchema, value, 'brandDiscovery.run');
  },
  /** A new discovery from a finished one's input; the finished one is left as it is. */
  rerun: async (id: string, idempotencyKey: string, options?: ApiRequestOptions) => {
    const value = await apiClient.post(`/brand-discoveries/${id}/rerun`, undefined, {
      ...options,
      idempotencyKey,
      retryNetworkFailures: true,
    });
    return strictValidate(brandDiscoverySchema, value, 'brandDiscovery.rerun');
  },
  complete: async (
    id: string,
    input: BrandDiscoveryCompleteRequest,
    idempotencyKey: string,
    options?: ApiRequestOptions,
  ) => {
    const value = await apiClient.post(`/brand-discoveries/${id}/complete`, input, {
      ...options,
      idempotencyKey,
      retryNetworkFailures: true,
    });
    return strictValidate(brandDiscoveryCompleteSchema, value, 'brandDiscovery.complete');
  },
};

export const brandDiscoveryQueries = {
  /** Discovery limits (the competitor cap); they change only with a deployment. */
  catalog: (workspaceId: string | null) =>
    queryOptions({
      queryKey: queryKeys.brandDiscovery.catalog(workspaceId),
      queryFn: ({ signal }) => brandDiscoveriesApi.catalog({ signal, workspaceId }),
      staleTime: Number.POSITIVE_INFINITY,
    }),
  detail: (workspaceId: string | null, discoveryId: string) =>
    queryOptions({
      queryKey: queryKeys.brandDiscovery.detail(workspaceId, discoveryId),
      queryFn: ({ signal }) => brandDiscoveriesApi.get(discoveryId, { signal, workspaceId }),
    }),
};

/**
 * Re-read one discovery, after a run settles or a completion whose outcome is
 * unknown: a request the browser abandoned may still have committed.
 */
export const refreshBrandDiscovery = (
  client: QueryClient,
  workspaceId: string | null,
  discoveryId: string,
) =>
  client.invalidateQueries({
    queryKey: queryKeys.brandDiscovery.detail(workspaceId, discoveryId),
  });

export const brandDiscoveryMutations = {
  /** Execute a queued discovery; its progress is re-read however the request ends. */
  run: () =>
    mutationOptions({
      mutationFn: ({ id, workspace }: { id: string; workspace: string | null }) =>
        brandDiscoveriesApi.run(id, { workspaceId: workspace }),
      onSettled: (_data, _error, { id, workspace }, _result, { client }) =>
        refreshBrandDiscovery(client, workspace, id),
    }),
};
