import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { refreshAuditExecutions, runsQueries } from '@/lib/api/runs';
import type { Audit } from '@citeladder/contracts';
import { useProjectScope } from '@/lib/project/active-project-scope';

/** The audit fields that move whenever one of its executions settles. */
type RunProgress = Pick<Audit, 'status' | 'completed_count' | 'failed_count' | 'updated_at'>;

/**
 * A run's executions, re-read only when the run's progress moves.
 *
 * The run page already polls the small audit row while the run is active, and
 * every settled execution moves that row's counts (and `updated_at`). Re-reading
 * the whole executions list on its own timer fetched every row every few
 * seconds even when nothing had changed; following the audit's progress
 * re-reads it once per change instead. The run's event stream still
 * invalidates the list directly for the task-level changes it reports.
 */
export function useRunExecutions(runId: string, audit: RunProgress | undefined) {
  const { workspaceId } = useProjectScope();
  const client = useQueryClient();
  // The workspace is part of the cache identity, so a switch never shows a
  // list read under another workspace; refreshing the run's executions
  // still reaches every workspace's copy.
  const query = useQuery(runsQueries.executions(workspaceId, runId));
  const progress = audit
    ? `${audit.status}:${audit.completed_count}:${audit.failed_count}:${audit.updated_at}`
    : null;
  const seen = useRef<{ runId: string; progress: string } | null>(null);
  useEffect(() => {
    if (progress === null) return;
    const previous = seen.current;
    seen.current = { runId, progress };
    if (previous?.runId === runId && previous.progress !== progress)
      void refreshAuditExecutions(client, runId);
  }, [client, progress, runId]);
  return query;
}
