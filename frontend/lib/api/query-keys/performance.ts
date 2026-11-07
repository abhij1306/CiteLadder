/**
 * Performance query-key namespace, on the shared scoped-key builder, so one
 * project's dashboard and tables never collide with another's.
 *
 * Every value the server binds a result to participates in the key: the
 * dashboard key carries the range and comparison selection, and the table key
 * carries the snapshot identity, dimension, sort, page size, cursor, and
 * comparison snapshot. That is what stops a cached page — or a retained
 * placeholder during a refetch — from being relabelled for a different result
 * set when the reader switches tab, sort, or range.
 */
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
