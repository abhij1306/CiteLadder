/**
 * Performance domain endpoints: the GSC-aligned dashboard projection, the six
 * dimension tables, the display-only range projection task, and the sync
 * pass-through that enqueues integrations sync runs.
 *
 * Read endpoints render persisted projections only (no
 * recomputation, no provider calls). A range with no persisted snapshot comes
 * back with a null `snapshot_id` and `not_run`; the caller then queues
 * `enqueueRange` for exactly that window and polls it. Series points are
 * nullable so unavailable buckets render as chart gaps, never invented zeros.
 * Every JSON response passes through `strictValidate` (fail loud on any
 * drift). All paths are relative `/api/v1` (same-origin proxy).
 */
import { mutationOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';

import { apiClient, type ApiRequestOptions } from './client';
import { queryKeys } from './query-keys';
import type { ProjectScope } from './query-keys/scope';
import { performanceSyncEnqueueResponseSchema } from '@citeladder/contracts/integrations';
import {
  performanceDashboardSchema,
  performanceRangeTaskSchema,
  performanceTablePageSchema,
  projectReadinessSchema,
  type performanceCompareSchema,
  type performanceDimensionSchema,
  type performanceGranularitySchema,
  type performanceRangeSchema,
  type projectReadinessStageSchema,
} from '@citeladder/contracts/performance';
import { strictValidate } from '@citeladder/contracts/validation';
import { definedQuery, withQuery } from './shared';
import { startInteractiveWork } from './interactive-work';

export type PerformanceRange = z.infer<typeof performanceRangeSchema>;
export type PerformanceCompare = z.infer<typeof performanceCompareSchema>;
export type PerformanceDimension = z.infer<typeof performanceDimensionSchema>;
export type PerformanceGranularity = z.infer<typeof performanceGranularitySchema>;
export type PerformanceDashboard = z.infer<typeof performanceDashboardSchema>;
export type PerformanceWindow = PerformanceDashboard['selected'];
export type PerformanceSeriesPoint = PerformanceWindow['series']['clicks'][number];
type PerformanceTablePage = z.infer<typeof performanceTablePageSchema>;
type PerformanceRangeTask = z.infer<typeof performanceRangeTaskSchema>;
export type PerformanceSyncEnqueueResponse = z.infer<typeof performanceSyncEnqueueResponseSchema>;
export type ProjectReadiness = z.infer<typeof projectReadinessSchema>;
export type ProjectReadinessStage = z.infer<typeof projectReadinessStageSchema>;

export type PerformanceDashboardParams = {
  range?: PerformanceRange;
  from?: string;
  to?: string;
  compare?: PerformanceCompare;
  compare_from?: string;
  compare_to?: string;
  granularity?: PerformanceGranularity;
};

export type PerformanceTableParams = {
  snapshot_id: string;
  dimension?: PerformanceDimension;
  sort?: string;
  cursor?: string;
  page_size?: number;
  compare_snapshot_id?: string;
};

const performanceApi = {
  getDashboard: async (
    projectId: string,
    params?: PerformanceDashboardParams,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/performance`, definedQuery(params));
    const res = await apiClient.get<PerformanceDashboard>(path, options);
    return strictValidate(performanceDashboardSchema, res, 'performance.getDashboard');
  },
  getReadiness: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<ProjectReadiness>(`/projects/${projectId}/readiness`, options);
    return strictValidate(projectReadinessSchema, res, 'performance.getReadiness');
  },
  getTable: async (
    projectId: string,
    params: PerformanceTableParams,
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/performance/table`, definedQuery(params));
    const res = await apiClient.get<PerformanceTablePage>(path, options);
    return strictValidate(performanceTablePageSchema, res, 'performance.getTable');
  },
  enqueueRange: async (
    projectId: string,
    params: { from: string; to: string },
    options?: ApiRequestOptions,
  ) => {
    const path = withQuery(`/projects/${projectId}/performance/range`, definedQuery(params));
    const res = await apiClient.post<PerformanceRangeTask>(path, undefined, options);
    const task = strictValidate(performanceRangeTaskSchema, res, 'performance.enqueueRange');
    startInteractiveWork(`/projects/${projectId}/performance/range/${task.task_id}/run`, options);
    return task;
  },
  getRangeTask: async (projectId: string, taskId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.get<PerformanceRangeTask>(
      `/projects/${projectId}/performance/range/${taskId}`,
      options,
    );
    return strictValidate(performanceRangeTaskSchema, res, 'performance.getRangeTask');
  },
  syncNow: async (projectId: string, options?: ApiRequestOptions) => {
    const res = await apiClient.post<PerformanceSyncEnqueueResponse>(
      `/projects/${projectId}/performance/sync`,
      undefined,
      options,
    );
    const runs = strictValidate(performanceSyncEnqueueResponseSchema, res, 'performance.syncNow');
    for (const run of runs)
      startInteractiveWork(
        `/integrations/${run.connection_id}/run?sync_run_id=${run.sync_run_id}`,
        options,
      );
    return runs;
  },
};

const scoped = (scope: ProjectScope, signal?: AbortSignal) => ({
  signal,
  workspaceId: scope.workspaceId,
});

export const performanceQueries = {
  dashboard: (scope: ProjectScope, params: PerformanceDashboardParams) =>
    queryOptions({
      queryKey: queryKeys.performance.dashboard(scope, params),
      queryFn: ({ signal }) =>
        performanceApi.getDashboard(scope.projectId, params, scoped(scope, signal)),
    }),
  table: (scope: ProjectScope, params: PerformanceTableParams) =>
    queryOptions({
      queryKey: queryKeys.performance.table(scope, params),
      queryFn: ({ signal }) =>
        performanceApi.getTable(scope.projectId, params, scoped(scope, signal)),
    }),
  readiness: (scope: ProjectScope) =>
    queryOptions({
      queryKey: queryKeys.performance.readiness(scope),
      queryFn: ({ signal }) => performanceApi.getReadiness(scope.projectId, scoped(scope, signal)),
    }),
  rangeTask: (scope: ProjectScope, taskId: string | null) =>
    queryOptions({
      queryKey: queryKeys.performance.rangeTask(scope, taskId ?? ''),
      queryFn: taskId
        ? ({ signal }) =>
            performanceApi.getRangeTask(scope.projectId, taskId, scoped(scope, signal))
        : skipToken,
    }),
};

export const refreshPerformance = (client: QueryClient, projectId: string) =>
  client.invalidateQueries({ queryKey: queryKeys.performance.project(projectId) });

export const performanceMutations = {
  enqueueRange: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: (window: { from: string; to: string }) =>
        performanceApi.enqueueRange(scope.projectId, window, scoped(scope)),
    }),
  syncNow: (scope: ProjectScope) =>
    mutationOptions({
      mutationFn: () => {
        if (!scope.workspaceId || !scope.projectId) throw new Error('Project is not available.');
        return performanceApi.syncNow(scope.projectId, scoped(scope));
      },
    }),
};
