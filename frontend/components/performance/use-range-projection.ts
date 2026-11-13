import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  performanceMutations,
  performanceQueries,
  refreshPerformance,
  type PerformanceDashboard,
} from '@/lib/api/performance';
import { pollRangeTask, RANGE_TASK_STATES } from '@/lib/performance/status';
import type { ActiveProjectScope } from '@/lib/project/active-project-scope';

/**
 * Materialize any window the dashboard reported as unprojected.
 *
 * A read never builds a projection, so when the selected or comparison window
 * has no snapshot the screen queues the display-only range task and refetches
 * once it completes. The task is idempotent on the window, so a re-render or
 * a second viewer joins the same work rather than duplicating it.
 */
export function useRangeProjection(
  scope: Pick<ActiveProjectScope, 'workspaceId' | 'projectId'>,
  data: PerformanceDashboard | undefined,
) {
  const { workspaceId, projectId } = scope;
  const queryClient = useQueryClient();
  const scopeKey = `${workspaceId}:${projectId}`;
  const [queued, setQueued] = useState<{
    scopeKey: string;
    taskId: string;
    window: RangeWindow;
  } | null>(null);
  // The window whose enqueue was refused. A task that ended failed or
  // cancelled is read from the task itself. Both stay apart from "never
  // imported", so the screen reports the failure and offers Retry (invariant 7).
  const [refused, setRefused] = useState<{
    scopeKey: string;
    window: RangeWindow;
    error: unknown;
  } | null>(null);
  // Read inside `onSuccess`, which runs long after the mutation was fired.
  const scopeKeyRef = useRef(scopeKey);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    scopeKeyRef.current = scopeKey;
    dataRef.current = data;
  }, [scopeKey, data]);
  const current = queued?.scopeKey === scopeKey ? queued : null;
  const pending = current?.taskId ?? null;
  const mutation = useMutation(performanceMutations.enqueueRange(scope));

  const task = useQuery({
    ...performanceQueries.rangeTask(scope, pending),
    refetchInterval: (query) => pollRangeTask(query.state.data?.status),
  });
  const status = task.data?.status;
  const terminal = status !== undefined && !RANGE_TASK_STATES[status].active;

  const missing = missingWindow(data);
  // A newly missing window starts clean: an earlier refusal and a task that
  // already ended belong to the window that was on screen before.
  const missingKey = missing && `${scopeKey}|${missing.from}|${missing.to}`;
  const [shownKey, setShownKey] = useState(missingKey);
  if (shownKey !== missingKey) {
    setShownKey(missingKey);
    setRefused(null);
    if (terminal) setQueued(null);
  }

  const request = (window: RangeWindow) => {
    const requested = scopeKey;
    // Two enqueues can be in flight when the selection moves while the first
    // is still open, and they can land in either order. A response only
    // counts if it is still the window this screen wants — otherwise the
    // later selection's poll would be replaced by the earlier one's task, and
    // the dashboard would never be refreshed for the window actually on screen.
    const superseded = () => {
      const wanted = missingWindow(dataRef.current);
      return requested !== scopeKeyRef.current || (wanted !== null && !sameWindow(wanted, window));
    };
    mutation.mutate(window, {
      onSuccess: (enqueued) => {
        if (!superseded()) setQueued({ scopeKey: requested, taskId: enqueued.task_id, window });
      },
      onError: (error) => {
        if (!superseded()) setRefused({ scopeKey: requested, window, error });
      },
    });
  };
  const requestMissing = useEffectEvent(request);
  const missingFrom = missing?.from;
  const missingTo = missing?.to;
  useEffect(() => {
    if (missingFrom !== undefined && missingTo !== undefined) {
      requestMissing({ from: missingFrom, to: missingTo });
    }
  }, [workspaceId, projectId, missingFrom, missingTo]);

  // Only a success changed a projection, so only a success invalidates, and
  // only once per task.
  const refreshedTask = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'succeeded' || pending === null || refreshedTask.current === pending) return;
    refreshedTask.current = pending;
    void refreshPerformance(queryClient, projectId);
  }, [status, pending, queryClient, projectId]);

  // EVERY terminal status ends `projecting`, not only a success; a failed or
  // cancelled task is reported for its window.
  const taskError = useMemo(() => {
    if (!terminal || status === 'succeeded') return null;
    return new Error(
      status === 'cancelled'
        ? 'Building this range was cancelled.'
        : 'Building this range from imported data failed.',
    );
  }, [terminal, status]);
  const failure = failureOnScreen(missing, [
    current && taskError ? { window: current.window, error: taskError, fromTask: true } : null,
    refused?.scopeKey === scopeKey
      ? { window: refused.window, error: refused.error, fromTask: false }
      : null,
  ]);
  return {
    projecting: Boolean(pending) && !terminal,
    /** The current window's projection failed: what happened, and Retry for exactly it. */
    failure: failure
      ? {
          error: failure.error,
          retry: () => {
            setRefused(null);
            if (failure.fromTask) setQueued(null);
            request(failure.window);
          },
          pending: mutation.isPending,
        }
      : null,
  };
}

type RangeWindow = Readonly<{ from: string; to: string }>;

type RangeFailure = Readonly<{ window: RangeWindow; error: unknown; fromTask: boolean }>;

function sameWindow(a: RangeWindow, b: RangeWindow) {
  return a.from === b.from && a.to === b.to;
}

/**
 * The failure that belongs to the window on screen. A task can end after the
 * reader moved on, so each candidate is matched to that window on its own: an
 * older window's ended task must not hide the refusal of the window that
 * replaced it.
 */
function failureOnScreen(
  missing: RangeWindow | null,
  candidates: readonly (RangeFailure | null)[],
): RangeFailure | null {
  if (!missing) return null;
  return candidates.find((failed) => failed !== null && sameWindow(failed.window, missing)) ?? null;
}

/** The first window the response reported as unprojected, if any. */
function missingWindow(data: PerformanceDashboard | undefined): RangeWindow | null {
  if (!data) return null;
  for (const window of [data.selected, data.comparison]) {
    if (window?.snapshot_id === null && window.window_start && window.window_end) {
      return { from: window.window_start, to: window.window_end };
    }
  }
  return null;
}
