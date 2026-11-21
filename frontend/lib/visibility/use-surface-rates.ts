import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { useEngineCatalog } from '@/lib/providers/engines';
import type { ActiveProjectScope } from '@/lib/project/active-project-scope';

export function useSurfaceRates({
  requestScope,
  engine,
  cohort,
  onInsights,
  activeRunId,
  selectedRunIds,
}: {
  requestScope: Pick<ActiveProjectScope, 'workspaceId' | 'projectId'>;
  engine: string | undefined;
  cohort: string;
  onInsights: boolean;
  activeRunId: string | null;
  selectedRunIds: string[] | undefined;
}) {
  const catalog = useEngineCatalog();
  const surfaceEngine = engine && catalog.isSearchSurface(engine) ? engine : null;
  const params = {
    engine: surfaceEngine ?? '',
    audit_id: selectedRunIds ? undefined : (activeRunId ?? undefined),
    audit_ids: selectedRunIds,
    cohort,
  };
  const surfaceRatesQuery = useQuery({
    ...visibilityQueries.surfaceRates(requestScope, params),
    enabled:
      onInsights && surfaceEngine !== null && Boolean(activeRunId) && selectedRunIds?.length !== 0,
    placeholderData: (data, query) =>
      retainPreviousDataForScope(requestScope.projectId, data, query),
  });
  return { surfaceEngine, surfaceRatesQuery };
}
