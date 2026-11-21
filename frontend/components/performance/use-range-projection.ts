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
  const [refused, setRefused] = useState<{
    scopeKey: string;
    window: RangeWindow;
    error: unknown;
  } | null>(null);
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
  const missingKey = missing && `${scopeKey}|${missing.from}|${missing.to}`;
  const [shownKey, setShownKey] = useState(missingKey);
  if (shownKey !== missingKey) {
    setShownKey(missingKey);
    setRefused(null);
    if (terminal) setQueued(null);
  }

  const request = (window: RangeWindow) => {
    const requested = scopeKey;
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

  const refreshedTask = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'succeeded' || pending === null || refreshedTask.current === pending) return;
    refreshedTask.current = pending;
    void refreshPerformance(queryClient, projectId);
  }, [status, pending, queryClient, projectId]);

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

function failureOnScreen(
  missing: RangeWindow | null,
  candidates: readonly (RangeFailure | null)[],
): RangeFailure | null {
  if (!missing) return null;
  return candidates.find((failed) => failed !== null && sameWindow(failed.window, missing)) ?? null;
}

function missingWindow(data: PerformanceDashboard | undefined): RangeWindow | null {
  if (!data) return null;
  for (const window of [data.selected, data.comparison]) {
    if (window?.snapshot_id === null && window.window_start && window.window_end) {
      return { from: window.window_start, to: window.window_end };
    }
  }
  return null;
}
