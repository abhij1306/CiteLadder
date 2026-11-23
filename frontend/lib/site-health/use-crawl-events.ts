import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';

import { siteHealthApi } from '@/lib/api/site-health';
import { refreshCrawlViews, refreshSiteHealthDashboard } from '@/lib/api/site-health-queries';
import {
  SITE_HEALTH_STREAM_INVALIDATE_DEBOUNCE_MS,
  SITE_HEALTH_STREAM_RECONNECT_BASE_MS,
  SITE_HEALTH_STREAM_RECONNECT_MAX_MS,
} from '@/lib/config/site-health';
import type { RawSseFrame } from '@/lib/sse/frames';
import { useSseEventStream } from '@/lib/sse/use-event-stream';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

const crawlFrameSchema = z.object({ event_type: z.string() });

function shouldInvalidateCrawl(frame: RawSseFrame): boolean {
  if (!frame.data) return false;
  try {
    const payload = crawlFrameSchema.safeParse(JSON.parse(frame.data));
    return !payload.success || !payload.data.event_type.endsWith('.progress');
  } catch {
    return true;
  }
}

export function useCrawlEvents(
  crawlId: string | null | undefined,
  projectId: string | null | undefined,
  enabled: boolean,
): void {
  const queryClient = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const onInvalidate = useCallback(() => {
    if (!crawlId) return;
    if (projectId) void refreshSiteHealthDashboard(queryClient, projectId);
    else void refreshCrawlViews(queryClient, crawlId);
  }, [crawlId, projectId, queryClient]);

  useSseEventStream({
    workspaceId,
    enabled: enabled && Boolean(crawlId),
    url: crawlId ? siteHealthApi.eventsUrl(crawlId) : null,
    invalidateDebounceMs: SITE_HEALTH_STREAM_INVALIDATE_DEBOUNCE_MS,
    reconnectBaseMs: SITE_HEALTH_STREAM_RECONNECT_BASE_MS,
    reconnectMaxMs: SITE_HEALTH_STREAM_RECONNECT_MAX_MS,
    onFrame: shouldInvalidateCrawl,
    onInvalidate,
  });
}
