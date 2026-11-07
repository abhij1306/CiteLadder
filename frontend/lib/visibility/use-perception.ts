'use client';

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

/**
 * The Perception tab's read: the same run / engine / prompt-type selection as
 * Sources. It rechecks while answers are still being classified, and a range
 * with no runs reads nothing rather than keeping the previous selection.
 */
export function usePerception(
  filters: Pick<SourceFilters, 'engine' | 'cohort'>,
  queries: SourceQueries,
) {
  const params = selectionParams(filters, queries);
  const enabled = selectionEnabled(queries);
  const query = useQuery({
    ...visibilityQueries.perception(
      { workspaceId: queries.workspaceId, projectId: queries.projectId ?? '' },
      params,
    ),
    enabled,
    placeholderData: enabled
      ? (data, previous) => retainPreviousDataForScope(queries.projectId!, data, previous)
      : undefined,
    refetchInterval: (current) =>
      current.state.data?.state === 'pending' ? PERCEPTION_PENDING_POLL_MS : false,
  });
  return { query, enabled };
}
