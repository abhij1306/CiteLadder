import { useEffect, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';

import { humanizeApiError } from '@/lib/api/errors';
import {
  integrationsQueries,
  refreshImportedReads,
  type IntegrationSyncRun,
} from '@/lib/api/integrations';
import { performanceMutations, type PerformanceSyncEnqueueResponse } from '@/lib/api/performance';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { isSyncInFlight, pollSyncRun } from '@/lib/integrations/status';

export function usePerformanceSync() {
  const { workspaceId, projectId } = useProjectScope();
  const scopeKey = `${workspaceId}:${projectId}`;
  const [batch, setBatch] = useState<{
    scopeKey: string;
    runs: PerformanceSyncEnqueueResponse;
    startedAt: string;
  } | null>(null);
  const currentBatch = batch?.scopeKey === scopeKey ? batch : null;
  const runs = currentBatch?.runs ?? [];
  const startedAt = currentBatch?.startedAt ?? null;
  const notice = currentBatch && !runs.length ? 'Nothing to sync yet.' : null;
  const mutation = useMutation(performanceMutations.syncNow({ workspaceId, projectId }));
  const start = () => {
    const requested = scopeKey;
    mutation.mutate(undefined, {
      onSuccess: (enqueued) =>
        setBatch({ scopeKey: requested, runs: enqueued, startedAt: new Date().toISOString() }),
    });
  };
  const runQueries = useQueries({
    queries: runs.map((run) => ({
      ...integrationsQueries.sync(workspaceId, run.connection_id, run.sync_run_id),
      refetchInterval: (query: { state: { data?: IntegrationSyncRun } }) =>
        pollSyncRun(query.state.data),
    })),
  });
  const enqueued = runs.length > 0;
  const settled =
    enqueued &&
    runQueries.every((query) => query.data !== undefined && !isSyncInFlight(query.data));
  let outcome: 'succeeded' | 'failed' | null = null;
  if (settled) {
    const allSucceeded = runQueries.every((query) => query.data?.status === 'succeeded');
    outcome = allSucceeded ? 'succeeded' : 'failed';
  }
  useRefreshWhenSettled(settled);
  return {
    mutation,
    start,
    notice,
    outcome,
    startedAt,
    syncing: enqueued && !settled,
    error: mutation.isError ? humanizeApiError(mutation.error).message : null,
  };
}

function useRefreshWhenSettled(settled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (settled) void refreshImportedReads(client);
  }, [settled, client]);
}
