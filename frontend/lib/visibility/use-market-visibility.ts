import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import type { VisibilityCohortParam } from '@/lib/api/visibility';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import type { ActiveProjectScope } from '@/lib/project/active-project-scope';
import { useProjectMarkets } from '@/lib/project/use-project-markets';

export function useMarketVisibility(
  requestScope: Pick<ActiveProjectScope, 'workspaceId' | 'projectId'>,
  params: { cohort: VisibilityCohortParam; topic?: string },
  onInsights: boolean,
) {
  const { workspaceId, projectId } = requestScope;
  const markets = useProjectMarkets(projectId, workspaceId);
  const marketRowsQuery = useQuery({
    ...visibilityQueries.markets(requestScope, params),
    enabled: onInsights && markets.length > 1,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId, data, query),
  });
  return { markets, marketRowsQuery };
}
