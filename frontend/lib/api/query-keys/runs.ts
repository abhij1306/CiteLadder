/** Runs (audits + executions), visibility and cited-page query-key namespaces. */
import type { ListFilters } from './shared';

export const runKeys = {
  all: ['runs'] as const,
  list: (filters: ListFilters = {}) => ['runs', 'list', filters] as const,
  detail: (auditId: string) => ['runs', 'detail', auditId] as const,
  executions: (auditId: string) => ['runs', 'executions', auditId] as const,
  execution: (executionId: string) => ['runs', 'execution', executionId] as const,
  schedules: (workspaceId: string | null, projectId: string) =>
    ['runs', 'schedules', workspaceId, projectId] as const,
};

export const visibilityKeys = {
  all: ['visibility'] as const,
  sources: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'sources', projectId, filters] as const,
  // The usage charts and one URL's detail. Separate namespaces from `sources`
  // because they are not the same read narrowed — paging the table must not
  // refetch a chart that does not page.
  sourceSeries: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'source-series', projectId, filters] as const,
  sourceUrl: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'source-url', projectId, filters] as const,
  sourceNearMisses: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'source-near-misses', projectId, filters] as const,
  sourceMovers: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'source-movers', projectId, filters] as const,
  fanout: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'fanout', projectId, filters] as const,
  project: (projectId: string, auditId?: string, filters: ListFilters = {}) =>
    ['visibility', 'project', projectId, auditId ?? 'latest', filters] as const,
  // Cross-run trend series: every filter (engine, from, to, granularity, cohort)
  // participates in the key so switching a control re-derives the view.
  trends: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'trends', projectId, filters] as const,
  perception: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'perception', projectId, filters] as const,
  accuracy: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'accuracy', projectId, filters] as const,
  ads: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'ads', projectId, filters] as const,
  evidence: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'evidence', projectId, filters] as const,
  // The observed-surface rates. Its own namespace because it is scoped by
  // the SURFACE as well as the selection, and changing the engine filter
  // must not refetch a projection that does not take one.
  surfaceRates: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'surface-rates', projectId, filters] as const,
  markets: (projectId: string, filters: ListFilters = {}) =>
    ['visibility', 'markets', projectId, filters] as const,
  prompts: (projectId: string, auditId?: string) =>
    ['visibility', 'prompts', projectId, auditId ?? 'latest'] as const,
  promptHistory: (projectId: string, promptId: string, filters: ListFilters = {}) =>
    ['visibility', 'prompt-history', projectId, promptId, filters] as const,
  competitorSuggestions: (projectId: string) =>
    ['visibility', 'competitor-suggestions', projectId] as const,
};
