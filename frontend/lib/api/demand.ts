/** Typed client for persisted Demand Intelligence projections, with its descriptors. */
import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { httpErrorStatus } from './errors';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import {
  demandRecomputeResponseSchema,
  demandSignalSchema,
  demandSnapshotSchema,
} from '@citeladder/contracts';
import type { DemandRecomputeRequest } from '@citeladder/contracts/demand';
import { strictValidate } from '@citeladder/contracts/validation';

export type DemandSignal = z.infer<typeof demandSignalSchema>;
export type DemandSnapshot = z.infer<typeof demandSnapshotSchema>;

export const demandApi = {
  getLatest: async (projectId: string, options?: ApiRequestOptions) =>
    strictValidate(
      demandSnapshotSchema,
      await apiClient.get<unknown>(`/projects/${projectId}/demand/latest`, options),
      'demand.getLatest',
    ),
  recompute: async (
    projectId: string,
    payload: DemandRecomputeRequest,
    options?: ApiRequestOptions,
  ) =>
    strictValidate(
      demandRecomputeResponseSchema,
      await apiClient.post<unknown>(`/projects/${projectId}/demand/recompute`, payload, options),
      'demand.recompute',
    ),
};

export const demandQueries = {
  /**
   * The latest Search Demand snapshot, shared by the screen and its route warmup.
   *
   * "No snapshot exists yet" (404) is a settled ANSWER, cached as `null`, not a
   * failure. Cached as an error it was retried on every mount, and TanStack
   * resets an errored query with no data back to `pending` while it retries —
   * so each visit replaced the settled empty state with the full skeleton for
   * the length of an identical request.
   */
  latest: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.demand.latest(scope),
      queryFn: async ({ signal }) => {
        try {
          return await demandApi.getLatest(scope.projectId, {
            signal,
            workspaceId: scope.workspaceId,
          });
        } catch (error) {
          if (httpErrorStatus(error) === 404) return null;
          throw error;
        }
      },
    }),
};

/** The project's latest snapshot, when the reader asks whether a recompute has landed. */
export const refreshDemandSnapshot = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.demand.resource(projectId, 'latest') });

export const demandMutations = {
  /**
   * Recompute is a QUEUED job, not a synchronous rebuild: the endpoint returns
   * 202 with `status: queued` and a worker produces the new snapshot later, so
   * a success refreshes nothing — re-reading now would return the current
   * snapshot and look like a no-op.
   */
  recompute: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (window: DemandRecomputeRequest) =>
        demandApi.recompute(scope.projectId, window, { workspaceId: scope.workspaceId }),
    }),
};
