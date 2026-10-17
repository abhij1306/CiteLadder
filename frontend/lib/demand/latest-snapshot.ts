import { queryOptions } from '@tanstack/react-query';

import { demandApi } from '@/lib/api/demand';
import { httpErrorStatus } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The latest Search Demand snapshot, shared by the screen and its route warmup.
 *
 * "No snapshot exists yet" (404) is a settled ANSWER, cached as `null`, not a
 * failure. Cached as an error it was retried on every mount, and TanStack
 * resets an errored query with no data back to `pending` while it retries —
 * so each visit replaced the settled empty state with the full skeleton for
 * the length of an identical request.
 */
export function latestDemandSnapshotQuery(projectId: string, workspaceId: string | null) {
  return queryOptions({
    queryKey: queryKeys.demand.latest(projectId),
    queryFn: async ({ signal }) => {
      try {
        return await demandApi.getLatest(projectId, { signal, workspaceId });
      } catch (error) {
        if (httpErrorStatus(error) === 404) return null;
        throw error;
      }
    },
  });
}
