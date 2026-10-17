'use client';

import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { PERCEPTION_PENDING_POLL_MS } from '@/lib/config/operational';
import type { SourceFilters } from '@/components/visibility/source-rows';
import {
  selectionEnabled,
  selectionParams,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

/**
 * The Accuracy tab's read: the same selection as Perception. It rechecks while
 * claims are still being checked, on the perception cadence.
 */
export function useAccuracy(
  filters: Pick<SourceFilters, 'engine' | 'cohort'>,
  queries: SourceQueries,
) {
  const params = selectionParams(filters, queries);
  const enabled = selectionEnabled(queries);
  const query = useQuery({
    queryKey: queryKeys.visibility.accuracy(queries.projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getAccuracy(queries.projectId!, params, {
        signal,
        workspaceId: queries.workspaceId,
      }),
    enabled,
    placeholderData: enabled
      ? (data, previous) => retainPreviousDataForScope(queries.projectId!, data, previous)
      : undefined,
    refetchInterval: (current) =>
      current.state.data?.state === 'pending' ? PERCEPTION_PENDING_POLL_MS : false,
  });
  return { query, enabled };
}
