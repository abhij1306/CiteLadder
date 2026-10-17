'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';

import { humanizeApiError } from '@/lib/api/errors';
import { integrationsApi, type IntegrationSyncRun } from '@/lib/api/integrations';
import { performanceApi, type PerformanceSyncEnqueueResponse } from '@/lib/api/performance';
import { queryKeys } from '@/lib/api/query-keys';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { isSucceededSyncRun, isSyncInFlight, SYNC_RUN_POLL_MS } from '@/lib/integrations/sync-runs';

/**
 * "Sync now" for the Performance surface: enqueue one integrations run per
 * active mapped connection, poll each to terminal, then invalidate the
 * projections the completed runs refreshed.
 *
 * The window each run covers is decided server-side and is INCREMENTAL — it
 * extends what the connection already imported rather than re-fetching a
 * fixed trailing window — so repeated syncs accumulate history instead of
 * rewriting the same dates.
 *
 * A terminal sync run means the IMPORT finished, NOT that the projection did:
 * the snapshot refresh (and, for referral datasets, ingest -> classify ->
 * referral snapshot) runs on the analytics worker afterwards. Each polled run
 * reports `processing` while the project still has those tasks queued, so the
 * batch stays in flight — Sync disabled, banner up — until the reports are
 * rebuilt, and the screen refetches once at that point.
 */
export function usePerformanceSync(projectId: string | null) {
  const workspaceId = useActiveWorkspaceId();
  const scopeKey = `${workspaceId}:${projectId}`;
  const [batch, setBatch] = useState<{
    scopeKey: string;
    runs: PerformanceSyncEnqueueResponse;
    startedAt: string;
  } | null>(null);
  const currentBatch = batch?.scopeKey === scopeKey ? batch : null;
  const runs = currentBatch?.runs ?? [];
  const startedAt = currentBatch?.startedAt ?? null;
  const notice =
    currentBatch && !runs.length
      ? 'Nothing to sync yet. Connect a data source and choose its property above.'
      : null;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !projectId) throw new Error('Project is not available.');
      const runs = await performanceApi.syncNow(projectId, { workspaceId });
      return { scopeKey, runs, startedAt: new Date().toISOString() };
    },
    onSuccess: setBatch,
  });
  const runQueries = useQueries({
    queries: runs.map((run) => ({
      queryKey: queryKeys.integrations.sync(run.connection_id, run.sync_run_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        integrationsApi.getSync(run.connection_id, run.sync_run_id, { signal, workspaceId }),
      refetchInterval: (query: { state: { data?: IntegrationSyncRun } }) => {
        const result = query.state.data;
        return !result || isSyncInFlight(result) ? SYNC_RUN_POLL_MS : false;
      },
    })),
  });
  const enqueued = runs.length > 0;
  const settled =
    enqueued &&
    runQueries.every((query) => query.data !== undefined && !isSyncInFlight(query.data));
  // Only a finished batch has an outcome, and it succeeded only if every run
  // in it did — one failure is a failed batch.
  let outcome: 'succeeded' | 'failed' | null = null;
  if (settled) {
    const allSucceeded = runQueries.every(
      (query) => query.data && isSucceededSyncRun(query.data.status),
    );
    outcome = allSucceeded ? 'succeeded' : 'failed';
  }
  useRefreshWhenSettled(settled);
  return {
    mutation,
    notice,
    outcome,
    startedAt,
    syncing: enqueued && !settled,
    error: mutation.isError ? humanizeApiError(mutation.error).message : null,
  };
}

/** Refetch the screen once, when the batch's reports have been rebuilt. */
function useRefreshWhenSettled(settled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!settled) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.integrations.all });
  }, [settled, queryClient]);
}
