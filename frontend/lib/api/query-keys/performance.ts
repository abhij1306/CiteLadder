/**
 * Performance query-key namespace — isolated by project so one project's
 * dashboard and tables never collide with another's.
 *
 * Every value the server binds a result to participates in the key: the
 * dashboard key carries the range and comparison selection, and the table key
 * carries the snapshot identity, dimension, sort, page size, cursor, and
 * comparison snapshot. That is what stops a cached page — or a retained
 * placeholder during a refetch — from being relabelled for a different result
 * set when the reader switches tab, sort, or range.
 */
import type { ListFilters } from './shared';

export const performanceKeys = {
  all: ['performance'] as const,
  dashboard: (projectId: string, filters: ListFilters = {}) =>
    ['performance', 'dashboard', projectId, filters] as const,
  table: (projectId: string, filters: ListFilters = {}) =>
    ['performance', 'table', projectId, filters] as const,
  rangeTask: (projectId: string, taskId: string) =>
    ['performance', 'range-task', projectId, taskId] as const,
  readiness: (projectId: string) => ['performance', 'readiness', projectId] as const,
};
