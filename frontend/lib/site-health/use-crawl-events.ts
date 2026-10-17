'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { API_BASE_URL } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/query-keys';
import {
  SITE_HEALTH_STREAM_INVALIDATE_DEBOUNCE_MS,
  SITE_HEALTH_STREAM_RECONNECT_BASE_MS,
  SITE_HEALTH_STREAM_RECONNECT_MAX_MS,
} from '@/lib/config/site-health';
import { invalidateCrawlViews } from '@/lib/site-health/invalidate';
import type { RawSseFrame } from '@/lib/sse/frames';
import { useSseEventStream } from '@/lib/sse/use-event-stream';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

function shouldInvalidateCrawl(frame: RawSseFrame): boolean {
  if (!frame.data) return false;
  try {
    const payload = JSON.parse(frame.data) as { event_type?: unknown };
    return typeof payload.event_type !== 'string' || !payload.event_type.endsWith('.progress');
  } catch {
    // An unfamiliar frame is never data, but it may announce a lifecycle change.
    return true;
  }
}

/**
 * Subscribes to a crawl's event stream while active. Lifecycle bursts refresh
 * the dashboard; per-page progress deliberately remains polling-backed.
 */
export function useCrawlEvents(
  crawlId: string | null | undefined,
  projectId: string | null | undefined,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const onInvalidate = useCallback(() => {
    if (!crawlId) return;
    if (projectId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.dashboard(projectId) });
    else invalidateCrawlViews(queryClient, crawlId);
  }, [crawlId, projectId, queryClient]);

  useSseEventStream({
    workspaceId,
    enabled: enabled && Boolean(crawlId),
    url: crawlId ? `${API_BASE_URL}/site-crawls/${crawlId}/events?stream=true` : null,
    invalidateDebounceMs: SITE_HEALTH_STREAM_INVALIDATE_DEBOUNCE_MS,
    reconnectBaseMs: SITE_HEALTH_STREAM_RECONNECT_BASE_MS,
    reconnectMaxMs: SITE_HEALTH_STREAM_RECONNECT_MAX_MS,
    onFrame: shouldInvalidateCrawl,
    onInvalidate,
    streamName: 'site-health',
  });
}
