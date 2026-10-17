'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { API_BASE_URL } from '@/lib/api/client';
import { invalidationsFor, parseAuditEvent, type RawSseFrame } from '@/lib/api/run-events';
import { AUDIT_RESULT_QUERY_ROOTS, queryKeys } from '@/lib/api/query-keys';
import {
  RUN_STREAM_INVALIDATE_DEBOUNCE_MS,
  RUN_STREAM_RECONNECT_BASE_MS,
  RUN_STREAM_RECONNECT_MAX_MS,
} from '@/lib/config/runs';
import { useSseEventStream } from '@/lib/sse/use-event-stream';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * Subscribes to a run's audit-event stream while it is active. The stream only
 * accelerates invalidations: the run page's polling remains the baseline.
 */
export function useRunEvents(
  auditId: string | null | undefined,
  projectId: string | null | undefined,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const pending = useRef(new Set<ReturnType<typeof invalidationsFor>[number]>());

  const onFrame = useCallback((frame: RawSseFrame) => {
    const event = parseAuditEvent(frame);
    if (event) {
      for (const family of invalidationsFor(event)) pending.current.add(family);
    } else if (frame.data) {
      // Drifted data is never treated as a DTO, but it still warrants a safe
      // refetch of the baseline run views.
      pending.current.add('audit');
      pending.current.add('executions');
    }
    return Boolean(frame.data);
  }, []);

  const onInvalidate = useCallback(() => {
    const families = pending.current;
    pending.current = new Set();
    if (!auditId) return;
    if (families.has('audit'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(auditId) });
    if (families.has('executions'))
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs.executions(auditId) });
    if (families.has('visibility') && projectId)
      for (const queryKey of AUDIT_RESULT_QUERY_ROOTS)
        void queryClient.invalidateQueries({ queryKey });
  }, [auditId, projectId, queryClient]);

  useSseEventStream({
    workspaceId,
    enabled: enabled && Boolean(auditId),
    url: auditId ? `${API_BASE_URL}/audits/${auditId}/events?stream=true` : null,
    invalidateDebounceMs: RUN_STREAM_INVALIDATE_DEBOUNCE_MS,
    reconnectBaseMs: RUN_STREAM_RECONNECT_BASE_MS,
    reconnectMaxMs: RUN_STREAM_RECONNECT_MAX_MS,
    onFrame,
    onInvalidate,
    streamName: 'runs',
  });
}
