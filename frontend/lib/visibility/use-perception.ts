import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { PERCEPTION_PENDING_POLL_MS } from '@/lib/config/operational';
import type { SourceFilters } from '@/components/visibility/source-rows';
import {
  periodSelectionParams,
  selectionEnabled,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

export function usePerception(
  filters: Pick<SourceFilters, 'engine' | 'cohort'>,
  queries: SourceQueries,
) {
  const params = periodSelectionParams(filters, queries);
  const enabled = selectionEnabled(queries);
  const query = useQuery({
    ...visibilityQueries.perception(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled,
    placeholderData: enabled
      ? (data, previous) => retainPreviousDataForScope(queries.projectId, data, previous)
      : undefined,
    refetchInterval: (current) =>
      current.state.data?.state === 'pending' ? PERCEPTION_PENDING_POLL_MS : false,
  });
  return query;
}
