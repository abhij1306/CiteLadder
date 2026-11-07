import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
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
