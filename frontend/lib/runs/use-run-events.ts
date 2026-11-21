import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { invalidationsFor, parseAuditEvent, type RawSseFrame } from '@/lib/api/run-events';
import {
  refreshAuditDetail,
  refreshAuditExecutions,
  refreshAuditResults,
  runsApi,
} from '@/lib/api/runs';
import {
  RUN_STREAM_INVALIDATE_DEBOUNCE_MS,
  RUN_STREAM_RECONNECT_BASE_MS,
  RUN_STREAM_RECONNECT_MAX_MS,
} from '@/lib/config/runs';
import { useSseEventStream } from '@/lib/sse/use-event-stream';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

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
    if (families.has('audit')) void refreshAuditDetail(queryClient, auditId);
    if (families.has('executions')) void refreshAuditExecutions(queryClient, auditId);
    if (families.has('visibility') && projectId) void refreshAuditResults(queryClient);
  }, [auditId, projectId, queryClient]);

  useSseEventStream({
    workspaceId,
    enabled: enabled && Boolean(auditId),
    url: auditId ? runsApi.eventsUrl(auditId) : null,
    invalidateDebounceMs: RUN_STREAM_INVALIDATE_DEBOUNCE_MS,
    reconnectBaseMs: RUN_STREAM_RECONNECT_BASE_MS,
    reconnectMaxMs: RUN_STREAM_RECONNECT_MAX_MS,
    onFrame,
    onInvalidate,
    streamName: 'runs',
  });
}
