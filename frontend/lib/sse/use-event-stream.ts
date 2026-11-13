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

/**
 * Refusals a reconnect cannot change: the session ended (401), access to the
 * workspace or record ended (403), or the run or crawl is gone (404). Anything
 * else (a dropped connection, 408, 429, 5xx) is worth asking again.
 */
const REFUSALS: ReadonlySet<number> = new Set([401, 403, 404]);

type StreamOutcome =
  | Readonly<{ kind: 'read'; frames: number }>
  | Readonly<{ kind: 'dropped' }>
  | Readonly<{ kind: 'refused' }>;

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
    // Written by the async reader and reconnect loop, so held in one effect-local object.
    const stream: {
      invalidateTimer: ReturnType<typeof setTimeout> | null;
      reconnectTimer: ReturnType<typeof setTimeout> | null;
      lastEventId: string | null;
    } = { invalidateTimer: null, reconnectTimer: null, lastEventId: null };

    const scheduleInvalidate = () => {
      if (stream.invalidateTimer !== null) return;
      stream.invalidateTimer = setTimeout(() => {
        stream.invalidateTimer = null;
        onInvalidate();
      }, invalidateDebounceMs);
    };

    const connect = async (): Promise<StreamOutcome> => {
      const response = await fetch(url, {
        method: 'GET',
        headers: streamHeaders(workspaceId, stream.lastEventId),
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (REFUSALS.has(response.status)) return { kind: 'refused' };
      if (!response.ok || !response.body) return { kind: 'dropped' };
      const frames = await readSseResponse(
        response.body,
        () => cancelled,
        (frame) => {
          if (frame.id) stream.lastEventId = frame.id;
          if (onFrame(frame)) scheduleInvalidate();
        },
      );
      return { kind: 'read', frames };
    };

    const run = async (attempt = 0) => {
      let outcome: StreamOutcome = { kind: 'dropped' };
      try {
        outcome = await connect();
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error(`[${streamName}] event stream failed`, { attempt, error });
      }
      if (cancelled || controller.signal.aborted) return;
      // Asking again cannot change a refusal. The screen's polled read stays
      // authoritative and reports why (an ended session reaches the session
      // guard from there).
      if (outcome.kind === 'refused') return;

      const hitDurationCap = outcome.kind === 'read' && outcome.frames > 0;
      const delay = hitDurationCap
        ? reconnectBaseMs
        : Math.min(reconnectBaseMs * 2 ** attempt, reconnectMaxMs);
      stream.reconnectTimer = setTimeout(() => void run(hitDurationCap ? 0 : attempt + 1), delay);
    };

    void run();
    return () => {
      cancelled = true;
      if (stream.invalidateTimer !== null) clearTimeout(stream.invalidateTimer);
      if (stream.reconnectTimer !== null) clearTimeout(stream.reconnectTimer);
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
