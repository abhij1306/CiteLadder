'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { performanceApi, type PerformanceDashboard } from '@/lib/api/performance';
import { queryKeys } from '@/lib/api/query-keys';
import type { ProjectRequestScope } from '@/lib/project/request-scope';

/**
 * Materialize any window the dashboard reported as unprojected.
 *
 * A read never builds a projection, so when the selected or comparison window
 * has no snapshot the screen queues the display-only range task and refetches
 * once it completes. The task is idempotent on the window, so a re-render or
 * a second viewer joins the same work rather than duplicating it.
 */
export function useRangeProjection(
  scope: ProjectRequestScope,
  data: PerformanceDashboard | undefined,
) {
  const { workspaceId, projectId } = scope;
  const queryClient = useQueryClient();
  const scopeKey = `${workspaceId}:${projectId}`;
  const [queued, setQueued] = useState<{
    scopeKey: string;
    taskId: string;
  } | null>(null);
  // Read inside `onSuccess`, which runs long after the mutation was fired.
  const scopeKeyRef = useRef(scopeKey);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey;
    dataRef.current = data;
  }, [scopeKey, data]);
  const pending = queued?.scopeKey === scopeKey ? queued.taskId : null;
  const mutation = useMutation({
    mutationFn: async (window: { from: string; to: string }) => {
      if (!scope.enabled) throw new Error('Project is not available.');
      const task = await performanceApi.enqueueRange(projectId, window, {
        workspaceId,
      });
      return { scopeKey, window, taskId: task.task_id };
    },
    // Two enqueues can be in flight when the selection moves while the first is
    // still open, and they can land in either order. A response is only allowed
    // to become the polled task if it is still the window this screen wants —
    // otherwise the later selection's poll would be replaced by the earlier
    // one's task, and the dashboard would never be invalidated for the window
    // actually on screen.
    onSuccess: (result) => {
      const wanted = missingWindow(dataRef.current);
      if (result.scopeKey !== scopeKeyRef.current) return;
      if (wanted && (wanted.from !== result.window.from || wanted.to !== result.window.to)) return;
      setQueued({ scopeKey: result.scopeKey, taskId: result.taskId });
    },
  });

  const missing = missingWindow(data);
  useEffect(() => {
    if (!scope.enabled || !missing) return;
    mutation.mutate(missing);
    // `missing` is a stable string pair derived from the response; re-running
    // on the mutation object itself would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.enabled, workspaceId, projectId, missing?.from, missing?.to]);

  const task = useQuery({
    queryKey: queryKeys.performance.rangeTask(projectId, pending ?? ''),
    queryFn: ({ signal }) =>
      performanceApi.getRangeTask(projectId, pending ?? '', {
        signal,
        workspaceId,
      }),
    enabled: scope.enabled && Boolean(pending),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'succeeded' || status === 'failed' || status === 'cancelled' ? false : 1500;
    },
  });

  const status = task.data?.status;
  const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';
  useEffect(() => {
    // EVERY terminal status releases the poll — a failed or cancelled task
    // that stayed pending would leave the surface reporting work that has
    // already stopped. Only a success changed a projection, so only a
    // success invalidates.
    if (!terminal) return;
    setQueued(null);
    if (status === 'succeeded') {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.performance.all,
      });
    }
  }, [terminal, status, queryClient]);

  return { projecting: Boolean(pending) && !terminal };
}

/** The first window the response reported as unprojected, if any. */
function missingWindow(data: PerformanceDashboard | undefined) {
  if (!data) return null;
  for (const window of [data.selected, data.comparison]) {
    if (window?.snapshot_id === null && window.window_start && window.window_end) {
      return { from: window.window_start, to: window.window_end };
    }
  }
  return null;
}
