/** Runs (audits + executions), visibility and cited-page query-key namespaces. */
import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const runs = scopedKeys('runs');
/** One run's row, in every workspace: the prefix a progress change refreshes. */
const auditDetail = (auditId: string) => ['runs', 'audit', auditId, 'detail'] as const;
/** One run's executions, in every workspace. */
const auditExecutions = (auditId: string) => ['runs', 'audit', auditId, 'executions'] as const;
export const runKeys = {
  ...runs,
  /** The project's runs, newest first. */
  list: (scope: ProjectScope) => runs.read('list', scope),
  schedules: (scope: ProjectScope) => runs.read('schedules', scope),
  // One run's reads are keyed by the run because a run page knows only its id;
  // the workspace comes last so the run's prefix reaches every workspace's copy.
  auditDetail,
  auditExecutions,
  detail: (workspaceId: string | null, auditId: string) =>
    [...auditDetail(auditId), workspaceId] as const,
  executions: (workspaceId: string | null, auditId: string) =>
    [...auditExecutions(auditId), workspaceId] as const,
  execution: (workspaceId: string | null, executionId: string) =>
    ['runs', 'execution', executionId, workspaceId] as const,
  // Its own root, not under `runs`: a launch invalidates `runs.all`, and the
  // estimate for the launch just sent must not be re-asked as the dialog closes.
  estimate: (workspaceId: string | null, input: Readonly<Record<string, unknown>> | null) =>
    ['audit-estimate', workspaceId, input] as const,
};

const visibility = scopedKeys('visibility');
export const visibilityKeys = {
  ...visibility,
  sources: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('sources', scope, filters),
  // The usage charts and one URL's detail. Separate resources from `sources`
  // because they are not the same read narrowed — paging the table must not
  // refetch a chart that does not page.
  sourceSeries: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('source-series', scope, filters),
  sourceUrl: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('source-url', scope, filters),
  sourceNearMisses: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('source-near-misses', scope, filters),
  sourceMovers: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('source-movers', scope, filters),
  fanout: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('fanout', scope, filters),
  /** The selection's projection: one run, a range, or the latest. */
  selection: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('selection', scope, filters),
  // Cross-run trend series: every filter (engine, from, to, granularity, cohort)
  // participates in the key so switching a control re-derives the view.
  trends: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('trends', scope, filters),
  perception: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('perception', scope, filters),
  accuracy: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('accuracy', scope, filters),
  ads: (scope: ProjectScope, filters: ListFilters = {}) => visibility.read('ads', scope, filters),
  evidence: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('evidence', scope, filters),
  // The observed-surface rates. Its own resource because it is scoped by the
  // SURFACE as well as the selection, and changing the engine filter must not
  // refetch a projection that does not take one.
  surfaceRates: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('surface-rates', scope, filters),
  markets: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('markets', scope, filters),
  /** One run's prompt rows; `null` reads the latest default-market run. */
  prompts: (scope: ProjectScope, auditId: string | null = null) =>
    visibility.read('prompts', scope, auditId ?? 'latest'),
  promptHistory: (scope: ProjectScope, promptId: string, filters: ListFilters = {}) =>
    visibility.read('prompt-history', scope, promptId, filters),
  competitorSuggestions: (scope: ProjectScope) => visibility.read('competitor-suggestions', scope),
};
