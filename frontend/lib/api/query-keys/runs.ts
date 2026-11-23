import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const runs = scopedKeys('runs');
const auditDetail = (auditId: string) => ['runs', 'audit', auditId, 'detail'] as const;
const auditExecutions = (auditId: string) => ['runs', 'audit', auditId, 'executions'] as const;
export const runKeys = {
  ...runs,
  list: (scope: ProjectScope) => runs.read('list', scope),
  schedules: (scope: ProjectScope) => runs.read('schedules', scope),
  auditDetail,
  auditExecutions,
  detail: (workspaceId: string | null, auditId: string) =>
    [...auditDetail(auditId), workspaceId] as const,
  executions: (workspaceId: string | null, auditId: string) =>
    [...auditExecutions(auditId), workspaceId] as const,
  execution: (workspaceId: string | null, executionId: string) =>
    ['runs', 'execution', executionId, workspaceId] as const,
  estimate: (workspaceId: string | null, input: Readonly<Record<string, unknown>> | null) =>
    ['audit-estimate', workspaceId, input] as const,
};

const visibility = scopedKeys('visibility');
export const visibilityKeys = {
  ...visibility,
  sources: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('sources', scope, filters),
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
  selection: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('selection', scope, filters),
  trends: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('trends', scope, filters),
  topics: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('topics', scope, filters),
  matrix: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('matrix', scope, filters),
  perception: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('perception', scope, filters),
  competitor: (scope: ProjectScope, name: string, filters: ListFilters = {}) =>
    visibility.read('competitor', scope, name, filters),
  accuracy: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('accuracy', scope, filters),
  accuracyFacts: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('accuracy-facts', scope, filters),
  accuracyClaims: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('accuracy-claims', scope, filters),
  ads: (scope: ProjectScope, filters: ListFilters = {}) => visibility.read('ads', scope, filters),
  evidence: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('evidence', scope, filters),
  surfaceRates: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('surface-rates', scope, filters),
  markets: (scope: ProjectScope, filters: ListFilters = {}) =>
    visibility.read('markets', scope, filters),
  prompts: (scope: ProjectScope, auditId: string | null = null) =>
    visibility.read('prompts', scope, auditId ?? 'latest'),
  latestPerPrompt: (scope: ProjectScope) => visibility.read('prompts', scope, 'latest-per-prompt'),
  promptHistory: (scope: ProjectScope, promptId: string, filters: ListFilters = {}) =>
    visibility.read('prompt-history', scope, promptId, filters),
  promptAnswers: (scope: ProjectScope, promptId: string, filters: ListFilters = {}) =>
    visibility.read('prompt-answers', scope, promptId, filters),
  competitorSuggestions: (scope: ProjectScope) => visibility.read('competitor-suggestions', scope),
};
