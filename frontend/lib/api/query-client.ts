/**
 * TanStack Query client factory + retry policy.
 *
 * `shouldRetryQuery`: retry transient failures only — network errors and
 * 408/429/5xx — capped at 2 attempts. 4xx (except 408/429) and aborts never
 * retry. When the backend (or the A3 timeout surface) classifies the failure
 * with an explicit `retryable` flag, that classification wins — an A3
 * `request_timeout` ApiError carries `retryable: true` and slots in here.
 * Read-mostly projections stay fresh for 60s and remain recoverable from the
 * cache for 30 minutes. Explicit polling intervals still own live workflows;
 * these defaults do not replace or slow their timers. Mutations never
 * auto-retry.
 */
import { QueryClient, type FetchQueryOptions, type QueryKey } from '@tanstack/react-query';

import {
  QUERY_NETWORK_ERROR_RETRIES,
  QUERY_RETRY_DELAY_MS,
  QUERY_SERVER_ERROR_RETRIES,
} from '@/lib/config/operational';

import { ApiError, httpErrorStatus, isAbortError } from './errors';

export function warmQuery<TOptions extends { queryKey: readonly unknown[] }>(
  client: QueryClient,
  options: TOptions,
): void {
  if (client.getQueryCache().find({ queryKey: options.queryKey })?.state.status === 'error') {
    return;
  }
  void client.prefetchQuery(options as never);
}

export function readFromIntent<TData, TKey extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TKey>,
): Promise<TData | null> {
  if (client.getQueryState(options.queryKey)?.status === 'error') return Promise.resolve(null);
  return client.fetchQuery(options).catch(() => null);
}

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (isAbortError(error)) return false;
  const status = httpErrorStatus(error);
  if (status === undefined && !(error instanceof ApiError)) {
    return failureCount < QUERY_NETWORK_ERROR_RETRIES;
  }
  if (failureCount >= QUERY_SERVER_ERROR_RETRIES) return false;
  if (error instanceof ApiError && typeof error.retryable === 'boolean') {
    return error.retryable;
  }
  return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

export function retainPreviousDataForScope<TData>(
  scopeId: string,
  previousData: TData | undefined,
  previousQuery: { queryKey: readonly unknown[] } | undefined,
): TData | undefined {
  return previousQuery?.queryKey.includes(scopeId) ? previousData : undefined;
}

let appQueryClient: QueryClient | undefined;

export function getAppQueryClient(): QueryClient {
  appQueryClient ??= createAppQueryClient();
  return appQueryClient;
}

export function setAppQueryClient(client: QueryClient | undefined) {
  appQueryClient = client;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay: QUERY_RETRY_DELAY_MS,
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
