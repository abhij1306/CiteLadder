import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { PERCEPTION_PENDING_POLL_MS } from '@/lib/config/operational';
import type { SourceFilters } from '@/components/visibility/source-rows';
import {
  selectionEnabled,
  selectionParams,
  type SourceQueries,
} from '@/lib/visibility/use-source-analysis';

type PerceptionFilters = Pick<SourceFilters, 'engine' | 'cohort'> & { market: string | null };

function perceptionParams(filters: PerceptionFilters, queries: SourceQueries) {
  const { audit_ids: _pooled, ...run } = selectionParams(filters, queries);
  return queries.selectedPeriod
    ? { ...run, market: filters.market ?? undefined, ...queries.selectedPeriod }
    : run;
}

export function usePerception(filters: PerceptionFilters, queries: SourceQueries) {
  const params = perceptionParams(filters, queries);
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
