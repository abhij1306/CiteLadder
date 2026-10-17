'use client';

import { useEffect } from 'react';

import { parseSseFrame, splitSseFrames, type RawSseFrame } from '@/lib/sse/frames';

type SseEventStreamOptions = {
  enabled: boolean;
  url: string | null;
  /**
   * The workspace this stream belongs to.
   *
   * Read from the caller rather than from the module-level selection, and part
   * of the effect's identity: a reconnect therefore resends the workspace the
   * stream STARTED under, and switching workspace tears the stream down
   * instead of silently resuming someone else's run under the new one.
   */
  workspaceId: string | null;
  invalidateDebounceMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  onFrame: (frame: RawSseFrame) => boolean;
  onInvalidate: () => void;
  streamName: string;
};

export function streamHeaders(
  workspaceId: string | null,
  lastEventId: string | null,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;
  return headers;
}

export async function readSseResponse(
  body: ReadableStream<Uint8Array>,
  isCancelled: () => boolean,
  onFrame: (frame: RawSseFrame) => void,
): Promise<number> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let count = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) return count;
    if (isCancelled()) return 0;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = splitSseFrames(buffer);
    buffer = rest;
    for (const raw of frames) {
      onFrame(parseSseFrame(raw));
      count += 1;
    }
  }
}

/**
 * Shared credentialed SSE transport for polling-backed screens. It handles
 * chunk framing, workspace credentials, resumption, reconnects, aborting, and
 * trailing debounce; callers retain their event classification and invalidation
 * targets so a stream remains an accelerator rather than a data source.
 */
export function useSseEventStream({
  enabled,
  url,
  workspaceId,
  invalidateDebounceMs,
  reconnectBaseMs,
  reconnectMaxMs,
  onFrame,
  onInvalidate,
  streamName,
}: SseEventStreamOptions): void {
  useEffect(() => {
    if (!enabled || !url) return;

    const controller = new AbortController();
    let cancelled = false;
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEventId: string | null = null;

    const scheduleInvalidate = () => {
      if (invalidateTimer !== null) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = null;
        onInvalidate();
      }, invalidateDebounceMs);
    };

    const connect = async (): Promise<number | null> => {
      const response = await fetch(url, {
        method: 'GET',
        headers: streamHeaders(workspaceId, lastEventId),
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) return null;
      return readSseResponse(
        response.body,
        () => cancelled,
        (frame) => {
          if (frame.id) lastEventId = frame.id;
          if (onFrame(frame)) scheduleInvalidate();
        },
      );
    };

    const run = async (attempt = 0) => {
      let frameCount: number | null = null;
      try {
        frameCount = await connect();
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error(`[${streamName}] event stream failed`, { attempt, error });
      }
      if (cancelled || controller.signal.aborted) return;

      const hitDurationCap = frameCount !== null && frameCount > 0;
      const delay = hitDurationCap
        ? reconnectBaseMs
        : Math.min(reconnectBaseMs * 2 ** attempt, reconnectMaxMs);
      reconnectTimer = setTimeout(() => void run(hitDurationCap ? 0 : attempt + 1), delay);
    };

    void run();
    return () => {
      cancelled = true;
      if (invalidateTimer !== null) clearTimeout(invalidateTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      controller.abort();
    };
  }, [
    enabled,
    invalidateDebounceMs,
    onFrame,
    onInvalidate,
    reconnectBaseMs,
    reconnectMaxMs,
    streamName,
    url,
    workspaceId,
  ]);
}
