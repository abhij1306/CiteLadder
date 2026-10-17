'use client';

import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { isSearchSurfaceEngine } from '@/lib/providers/catalog';
import type { ProjectRequestScope } from '@/lib/project/request-scope';

/**
 * The observed-surface rates, scoped to the same resolved run selection the
 * rest of the tab reads.
 *
 * Its own hook rather than more lines inside `useVisibilityQueries`: it is the
 * only read here that is gated on WHICH surface is selected, and folding that
 * condition into the shared body put a filter-specific branch in front of
 * every other query.
 *
 * Requested only when the filter names an observed surface. The five rates are
 * properties of that surface, and asking an answer engine for a trigger rate
 * is a category error rather than a query with an empty result.
 */
export function useSurfaceRates({
  requestScope,
  projectId,
  engine,
  cohort,
  onTrendsTab,
  activeRunId,
  selectedRunIds,
}: {
  requestScope: ProjectRequestScope;
  projectId: string | null;
  engine: string | undefined;
  cohort: string;
  onTrendsTab: boolean;
  activeRunId: string | null;
  selectedRunIds: string[] | undefined;
}) {
  const surfaceEngine = engine && isSearchSurfaceEngine(engine) ? engine : null;
  const params = {
    engine: surfaceEngine ?? '',
    audit_id: selectedRunIds ? undefined : (activeRunId ?? undefined),
    audit_ids: selectedRunIds,
    cohort,
  };
  const surfaceRatesQuery = useQuery({
    queryKey: queryKeys.visibility.surfaceRates(projectId ?? '', params),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      visibilityApi.getSurfaceRates(requestScope.projectId, params, {
        signal,
        workspaceId: requestScope.workspaceId,
      }),
    enabled:
      requestScope.enabled &&
      onTrendsTab &&
      surfaceEngine !== null &&
      Boolean(activeRunId) &&
      selectedRunIds?.length !== 0,
    placeholderData: (data, query) => retainPreviousDataForScope(projectId!, data, query),
  });
  return { surfaceEngine, surfaceRatesQuery };
}
