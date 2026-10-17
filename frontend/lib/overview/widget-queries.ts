/**
 * Reads behind the Overview's library widgets. Each uses its page's own
 * defaults (latest run, organic prompts, default market and window), and the
 * page's query key where one exists, so a widget and its page share a cache.
 */
import { useQuery } from '@tanstack/react-query';

import { aiTrafficApi } from '@/lib/api/ai-traffic';
import { performanceQueries } from '@/lib/api/performance';
import { queryKeys } from '@/lib/api/query-keys';
import type { Project } from '@/lib/api/types';
import { INITIAL_VISIBILITY_PARAMS, visibilityApi, visibilityQueries } from '@/lib/api/visibility';
import { TRAFFIC_RANGES } from '@/lib/config/crawl-logs';
import { INITIAL_DASHBOARD_PARAMS } from '@/lib/performance/performance';

/** Rows a list widget shows; padded to this count so the card never resizes. */
export const WIDGET_ROWS = 5;
const COHORT = 'core';

const scope = (project: Project) => ({ workspaceId: project.workspace_id });

/** The latest run's projection, shared with Visibility's first paint. */
export function useLatestVisibility(project: Project) {
  return useQuery(
    visibilityQueries.project(project.workspace_id, project.id, INITIAL_VISIBILITY_PARAMS),
  );
}

export function useVisibilityTrend(project: Project) {
  const params = { cohort: COHORT } as const;
  return useQuery({
    queryKey: queryKeys.visibility.trends(project.id, params),
    queryFn: ({ signal }) =>
      visibilityApi.getVisibilityTrends(project.id, params, { ...scope(project), signal }),
  });
}

/** Domain movers against the latest run's comparable baseline, when it has one. */
export function useLatestMovers(project: Project) {
  const visibility = useLatestVisibility(project);
  const comparison = visibility.data?.comparison;
  const baseline = comparison?.status === 'comparable' ? comparison.baseline_audit_ids : [];
  const params = {
    audit_id: visibility.data?.audit_id ?? undefined,
    cohort: COHORT,
    baseline_audit_ids: baseline,
    dimension: 'domain' as const,
    limit: WIDGET_ROWS,
  };
  const movers = useQuery({
    queryKey: queryKeys.visibility.sourceMovers(project.id, params),
    queryFn: ({ signal }) =>
      visibilityApi.getSourceMovers(project.id, params, { ...scope(project), signal }),
    enabled: Boolean(params.audit_id && baseline.length),
  });
  return { visibility, movers, comparable: baseline.length > 0 };
}

export function useLatestNearMisses(project: Project) {
  const visibility = useLatestVisibility(project);
  const params = {
    audit_id: visibility.data?.audit_id ?? undefined,
    cohort: COHORT,
    limit: WIDGET_ROWS,
  };
  const misses = useQuery({
    queryKey: queryKeys.visibility.sourceNearMisses(project.id, params),
    queryFn: ({ signal }) =>
      visibilityApi.getSourceNearMisses(project.id, params, { ...scope(project), signal }),
    enabled: Boolean(params.audit_id),
  });
  return { visibility, misses };
}

export function useLatestPerception(project: Project) {
  const visibility = useLatestVisibility(project);
  const params = { audit_id: visibility.data?.audit_id ?? undefined, cohort: COHORT };
  const perception = useQuery({
    queryKey: queryKeys.visibility.perception(project.id, params),
    queryFn: ({ signal }) =>
      visibilityApi.getPerception(project.id, params, { ...scope(project), signal }),
    enabled: Boolean(params.audit_id),
  });
  return { visibility, perception };
}

export function useTrafficOverview(project: Project) {
  // The same filters AI Traffic prefetches, so both read one cache entry.
  const params = {
    range: TRAFFIC_RANGES[0].value,
    verification: undefined,
    purpose: undefined,
    bot_id: undefined,
    status: undefined,
    folder: undefined,
    resource_class: undefined,
  };
  return useQuery({
    queryKey: queryKeys.aiTraffic.view(project.workspace_id, project.id, 'overview', params),
    queryFn: ({ signal }) =>
      aiTrafficApi.overview(project.id, params, { ...scope(project), signal }),
  });
}

export function useSearchPerformance(project: Project) {
  return useQuery(
    performanceQueries.dashboard(project.workspace_id, project.id, INITIAL_DASHBOARD_PARAMS),
  );
}
