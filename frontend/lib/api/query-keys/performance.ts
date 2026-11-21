import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const performance = scopedKeys('performance');
export const performanceKeys = {
  ...performance,
  dashboard: (scope: ProjectScope, filters: ListFilters = {}) =>
    performance.read('dashboard', scope, filters),
  table: (scope: ProjectScope, filters: ListFilters = {}) =>
    performance.read('table', scope, filters),
  rangeTask: (scope: ProjectScope, taskId: string) => performance.read('range-task', scope, taskId),
  readiness: (scope: ProjectScope) => performance.read('readiness', scope),
};
