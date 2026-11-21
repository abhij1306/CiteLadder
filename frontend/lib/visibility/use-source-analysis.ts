import { useQuery } from '@tanstack/react-query';

import { retainPreviousDataForScope } from '@/lib/api/query-client';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import type { SourceFilters } from '@/components/visibility/source-rows';
import type { useVisibilityQueries } from '@/lib/visibility/use-visibility-dashboard';
import { availableTypes } from '@/lib/visibility/sources';

export type SourceQueries = ReturnType<typeof useVisibilityQueries>;

function set<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

const SOURCE_DOMAIN_OPTIONS = 50;

export type SourceScope = {
  dimension: 'domain' | 'url';
  domain: string | null;
  cursor: string | null;
  asOf: string | null;
  sourceType: string | null;
  gapOnly: boolean;
  pageSize: number;
};

export function selectionParams(
  filters: Pick<SourceFilters, 'engine' | 'cohort'>,
  queries: SourceQueries,
) {
  return {
    audit_id: queries.selectedRunIds ? undefined : set(queries.activeRunId),
    audit_ids: queries.selectedRunIds,
    engine: set(filters.engine === 'all' ? null : filters.engine),
    cohort: filters.cohort,
  };
}

export function topicSelectionParams(
  filters: Pick<SourceFilters, 'engine' | 'cohort'>,
  queries: SourceQueries,
) {
  return { ...selectionParams(filters, queries), topic: queries.topic };
}

export function periodSelectionParams(
  filters: Pick<SourceFilters, 'engine' | 'cohort'>,
  queries: SourceQueries,
) {
  return { ...selectionParams(filters, queries), ...queries.selectedPeriod };
}

export function selectionEnabled(queries: SourceQueries): boolean {
  return Boolean(queries.activeRunId && queries.selectedRunIds?.length !== 0);
}

export function useSourceAnalysis(
  filters: SourceFilters,
  queries: SourceQueries,
  scope: SourceScope,
) {
  const comparison = queries.visibilityQuery.data?.comparison;
  const params = {
    ...topicSelectionParams(filters, queries),
    baseline_audit_ids:
      comparison?.status === 'comparable' ? comparison.baseline_audit_ids : undefined,
    domain: set(scope.domain),
    source_type: set(scope.sourceType),
    standing: scope.gapOnly ? ('gap' as const) : undefined,
    dimension: scope.dimension,
    cursor: set(scope.cursor),
    as_of: set(scope.asOf),
    limit: scope.pageSize,
  };
  const sourceQuery = useQuery({
    ...visibilityQueries.sources(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: Boolean(queries.activeRunId),
    placeholderData: (data, query) => retainPreviousDataForScope(queries.projectId, data, query),
  });
  return { params, sourceQuery };
}

export function useSourceSeries(
  filters: SourceFilters,
  queries: SourceQueries,
  scope: Pick<SourceScope, 'dimension' | 'domain' | 'sourceType'> & {
    url?: string | null;
    enabled?: boolean;
  },
) {
  const params = {
    ...topicSelectionParams(filters, queries),
    dimension: scope.dimension,
    granularity: filters.granularity === 'run' ? 'day' : filters.granularity,
    domain: set(scope.domain),
    url: set(scope.url),
    source_type: set(scope.sourceType),
  };
  return useQuery({
    ...visibilityQueries.sourceSeries(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: Boolean(queries.activeRunId) && scope.enabled !== false,
    placeholderData: (data, query) => retainPreviousDataForScope(queries.projectId, data, query),
  });
}

export function useSourceUrl(filters: SourceFilters, queries: SourceQueries, url: string | null) {
  const params = { ...topicSelectionParams(filters, queries), url: url ?? '' };
  return useQuery({
    ...visibilityQueries.sourceUrl(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: Boolean(queries.activeRunId && url),
  });
}

export function useSourceDomains(filters: SourceFilters, queries: SourceQueries, enabled: boolean) {
  const params = {
    ...topicSelectionParams(filters, queries),
    dimension: 'domain' as const,
    limit: SOURCE_DOMAIN_OPTIONS,
  };
  const query = useQuery({
    ...visibilityQueries.sources(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: enabled && Boolean(queries.activeRunId),
  });
  return (query.data?.items ?? []).map((item) => item.key).filter(Boolean);
}

export function useSourceTypes(
  filters: SourceFilters,
  queries: SourceQueries,
  scope: Pick<SourceScope, 'dimension' | 'domain'> & { enabled: boolean },
) {
  const params = {
    ...topicSelectionParams(filters, queries),
    dimension: scope.dimension,
    domain: set(scope.domain),
    limit: SOURCE_DOMAIN_OPTIONS,
  };
  const query = useQuery({
    ...visibilityQueries.sources(
      { workspaceId: queries.workspaceId, projectId: queries.projectId },
      params,
    ),
    enabled: scope.enabled && Boolean(queries.activeRunId),
  });
  return availableTypes(query.data?.category_totals, scope.dimension);
}
