/**
 * Visibility read options, so a screen, an Overview widget and navigation
 * intent request the SAME key from one definition instead of each assembling
 * its own.
 */
import { queryOptions } from '@tanstack/react-query';

import { ApiError } from './errors';
import { queryKeys } from './query-keys';
import type { Visibility } from './types';
import { visibilityApi, type ProjectVisibilityParams } from './visibility';

type TrendParams = Parameters<typeof visibilityApi.getVisibilityTrends>[1];
type NearMissParams = Parameters<typeof visibilityApi.getSourceNearMisses>[1];
type MoverParams = Parameters<typeof visibilityApi.getSourceMovers>[1];
type PerceptionParams = Parameters<typeof visibilityApi.getPerception>[1];

const hasCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

/**
 * The selection's run exists but its metrics are not written yet: its own
 * state ("still being prepared"), never "nothing measured" and never a failure.
 */
export const isMetricsPending = (error: unknown) => hasCode(error, 'visibility_metrics_pending');

export const visibilityQueries = {
  /**
   * The selection's projection, or `null` when the server answers
   * `visibility_not_measured` (no completed measured run, or a period that
   * measured nothing). Cached as an error it was always stale, so every mount
   * re-asked for the same answer; a run arriving or finishing invalidates
   * `visibility.all` instead. Metrics still being written
   * (`visibility_metrics_pending`, see `isMetricsPending`), a run that does not
   * exist and every other failure stay errors.
   */
  project: (workspaceId: string, projectId: string, params: ProjectVisibilityParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.project(projectId, params.audit_id, params),
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Visibility | null> => {
        try {
          return await visibilityApi.getProjectVisibility(projectId, params, {
            signal,
            workspaceId,
          });
        } catch (error) {
          if (hasCode(error, 'visibility_not_measured')) return null;
          throw error;
        }
      },
    }),
  trends: (workspaceId: string, projectId: string, params: TrendParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.trends(projectId, params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        visibilityApi.getVisibilityTrends(projectId, params, { signal, workspaceId }),
    }),
  sourceNearMisses: (workspaceId: string, projectId: string, params: NearMissParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.sourceNearMisses(projectId, params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        visibilityApi.getSourceNearMisses(projectId, params, { signal, workspaceId }),
    }),
  sourceMovers: (workspaceId: string, projectId: string, params: MoverParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.sourceMovers(projectId, params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        visibilityApi.getSourceMovers(projectId, params, { signal, workspaceId }),
    }),
  perception: (workspaceId: string, projectId: string, params: PerceptionParams) =>
    queryOptions({
      queryKey: queryKeys.visibility.perception(projectId, params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        visibilityApi.getPerception(projectId, params, { signal, workspaceId }),
    }),
  /** The latest default-market run's prompt rows (Prompts table and Overview). */
  latestPrompts: (workspaceId: string, projectId: string) =>
    queryOptions({
      queryKey: queryKeys.visibility.prompts(projectId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        visibilityApi.getPromptMetrics(projectId, undefined, { signal, workspaceId }),
    }),
};
