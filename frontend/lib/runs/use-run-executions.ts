import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { refreshAuditExecutions, runsQueries } from '@/lib/api/runs';
import type { Audit } from '@citeladder/contracts';
import { useProjectScope } from '@/lib/project/active-project-scope';

type RunProgress = Pick<Audit, 'status' | 'completed_count' | 'failed_count' | 'updated_at'>;

export function useRunExecutions(runId: string, audit: RunProgress | undefined) {
  const { workspaceId } = useProjectScope();
  const client = useQueryClient();
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
