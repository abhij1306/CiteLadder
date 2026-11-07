/**
 * Reads behind the Overview's widgets. Each uses its page's own defaults
 * (latest run, organic prompts, default market and window) and its page's
 * query factory, so a widget and its page share a cache entry.
 *
 * The same definitions drive `warmOverviewWidgets`, which starts a layout's
 * reads before the widgets mount: from navigation intent beside the command
 * center, and from the screen as soon as the layout names them.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';

import type { OverviewWidget, OverviewWidgetKey } from '@citeladder/contracts/overview';
import { aiTrafficQueries } from '@/lib/api/ai-traffic';
import { performanceQueries } from '@/lib/api/performance';
import { warmQuery } from '@/lib/api/query-client';
import type { Project, Visibility } from '@citeladder/contracts';
import { INITIAL_VISIBILITY_PARAMS } from '@/lib/api/visibility';
import { visibilityQueries } from '@/lib/api/visibility-queries';
import { TRAFFIC_RANGES } from '@/lib/config/crawl-logs';
import { INITIAL_DASHBOARD_PARAMS } from '@/lib/performance/performance';

/** Rows a list widget shows; padded to this count so the card never resizes. */
export const WIDGET_ROWS = 5;
const COHORT = 'core';

type WidgetProject = Pick<Project, 'id' | 'workspace_id'>;
const widgetScope = (project: WidgetProject) => ({
  workspaceId: project.workspace_id,
  projectId: project.id,
});
type LatestVisibility = Visibility | null | undefined;

const latestVisibilityQuery = (project: WidgetProject) =>
  visibilityQueries.project(widgetScope(project), INITIAL_VISIBILITY_PARAMS);

const trendQuery = (project: WidgetProject) =>
  visibilityQueries.trends(widgetScope(project), { cohort: COHORT });

// The overview's own filters, as AI Traffic prefetches them: an unset filter is
// absent from both the key and the request, so both read one cache entry.
const trafficOverviewQuery = (project: WidgetProject) =>
  aiTrafficQueries.overview(widgetScope(project), { range: TRAFFIC_RANGES[0].value });

const searchPerformanceQuery = (project: WidgetProject) =>
  performanceQueries.dashboard(widgetScope(project), INITIAL_DASHBOARD_PARAMS);

/** Domain movers against the latest run's comparable baseline; empty when it has none. */
function moverParams(visibility: LatestVisibility) {
  const comparison = visibility?.comparison;
  return {
    audit_id: visibility?.audit_id,
    cohort: COHORT,
    baseline_audit_ids: comparison?.status === 'comparable' ? comparison.baseline_audit_ids : [],
    dimension: 'domain' as const,
    limit: WIDGET_ROWS,
  };
}

const nearMissParams = (visibility: LatestVisibility) => ({
  audit_id: visibility?.audit_id,
  cohort: COHORT,
  limit: WIDGET_ROWS,
});

const perceptionParams = (visibility: LatestVisibility) => ({
  audit_id: visibility?.audit_id,
  cohort: COHORT,
});

const moversReady = (params: ReturnType<typeof moverParams>) =>
  Boolean(params.audit_id && params.baseline_audit_ids.length);

/** The latest run's projection, shared with Visibility's first paint. */
export function useLatestVisibility(project: Project) {
  return useQuery(latestVisibilityQuery(project));
}

export function useVisibilityTrend(project: Project) {
  return useQuery(trendQuery(project));
}

export function useLatestMovers(project: Project) {
  const visibility = useLatestVisibility(project);
  const params = moverParams(visibility.data);
  const movers = useQuery({
    ...visibilityQueries.sourceMovers(widgetScope(project), params),
    enabled: moversReady(params),
  });
  // The projection's own comparison, so the widget can say WHY nothing moved
  // (no earlier run, changed settings, incomplete coverage) rather than one "not comparable".
  return { visibility, movers, comparison: visibility.data?.comparison ?? null };
}

export function useLatestNearMisses(project: Project) {
  const visibility = useLatestVisibility(project);
  const params = nearMissParams(visibility.data);
  const misses = useQuery({
    ...visibilityQueries.sourceNearMisses(widgetScope(project), params),
    enabled: Boolean(params.audit_id),
  });
  return { visibility, misses };
}

export function useLatestPerception(project: Project) {
  const visibility = useLatestVisibility(project);
  const params = perceptionParams(visibility.data);
  const perception = useQuery({
    ...visibilityQueries.perception(widgetScope(project), params),
    enabled: Boolean(params.audit_id),
  });
  return { visibility, perception };
}

export function useTrafficOverview(project: Project) {
  return useQuery(trafficOverviewQuery(project));
}

export function useSearchPerformance(project: Project) {
  return useQuery(searchPerformanceQuery(project));
}

/**
 * The latest run's projection for a warmup that needs its run id. A projection
 * that already failed stays as it is (see `warmQuery`), and its dependents wait
 * for the widget to retry it.
 */
function warmedVisibility(client: QueryClient, project: WidgetProject) {
  const options = latestVisibilityQuery(project);
  if (client.getQueryState(options.queryKey)?.status === 'error') return Promise.resolve(null);
  return client.ensureQueryData(options).catch(() => null);
}

type WidgetWarmup = (client: QueryClient, project: WidgetProject) => Promise<void> | void;

/**
 * What each widget reads before it can paint. `null` is a widget drawn from the
 * command center alone; a new widget fails the type check until it says which.
 */
const WIDGET_WARMUPS: Readonly<Record<OverviewWidgetKey, WidgetWarmup | null>> = {
  project_state: null,
  citation_share: null,
  movement: null,
  next_action: null,
  ranked_actions: null,
  progress_proof: null,
  company_facts: null,
  missing_prompts: (client, project) =>
    warmQuery(client, visibilityQueries.prompts(widgetScope(project))),
  visibility_trend: (client, project) => warmQuery(client, trendQuery(project)),
  share_of_voice: (client, project) => warmQuery(client, latestVisibilityQuery(project)),
  top_movers: async (client, project) => {
    const params = moverParams(await warmedVisibility(client, project));
    if (moversReady(params))
      warmQuery(client, visibilityQueries.sourceMovers(widgetScope(project), params));
  },
  retrieval: async (client, project) => {
    const params = nearMissParams(await warmedVisibility(client, project));
    if (params.audit_id)
      warmQuery(client, visibilityQueries.sourceNearMisses(widgetScope(project), params));
  },
  perception: async (client, project) => {
    const params = perceptionParams(await warmedVisibility(client, project));
    if (params.audit_id)
      warmQuery(client, visibilityQueries.perception(widgetScope(project), params));
  },
  ai_traffic: (client, project) => warmQuery(client, trafficOverviewQuery(project)),
  search_console: (client, project) => warmQuery(client, searchPerformanceQuery(project)),
};

/**
 * Start the reads a layout's widgets will make, so they run beside the command
 * center instead of after it. Reads that need the latest run's id start the
 * moment that projection lands rather than when the widget mounts.
 */
export async function warmOverviewWidgets(
  client: QueryClient,
  project: WidgetProject,
  widgets: readonly Pick<OverviewWidget, 'key'>[],
): Promise<void> {
  await Promise.all(widgets.map(async ({ key }) => WIDGET_WARMUPS[key]?.(client, project)));
}
