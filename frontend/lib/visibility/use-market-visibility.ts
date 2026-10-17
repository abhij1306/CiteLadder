'use client';

import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi, type VisibilityCohortParam } from '@/lib/api/visibility';
import type { ProjectRequestScope } from '@/lib/project/request-scope';
import { useProjectMarkets } from '@/lib/project/use-project-markets';

/**
 * The project's markets, and each one's latest run side by side once there is
 * more than the default. Both reads are persisted projections.
 */
export function useMarketVisibility(
  requestScope: ProjectRequestScope,
  cohort: VisibilityCohortParam,
  onTrendsTab: boolean,
) {
  const { workspaceId, projectId } = requestScope;
  const markets = useProjectMarkets(projectId, workspaceId, requestScope.enabled);
  const params = { cohort };
  const marketRowsQuery = useQuery({
    queryKey: queryKeys.visibility.markets(projectId, params),
    queryFn: ({ signal }) =>
      visibilityApi.getMarketVisibility(projectId, params, { signal, workspaceId }),
    enabled: requestScope.enabled && onTrendsTab && markets.length > 1,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  return { markets, marketRowsQuery };
}
