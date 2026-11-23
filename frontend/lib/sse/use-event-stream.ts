import { useEffect } from 'react';

import { parseSseFrame, splitSseFrames, type RawSseFrame } from '@/lib/sse/frames';

type SseEventStreamOptions = {
  enabled: boolean;
  url: string | null;
  workspaceId: string | null;
  invalidateDebounceMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  onFrame: (frame: RawSseFrame) => boolean;
  onInvalidate: () => void;
};

const REFUSALS: ReadonlySet<number> = new Set([401, 403, 404]);

type StreamOutcome =
  | Readonly<{ kind: 'read'; frames: number }>
  | Readonly<{ kind: 'dropped' }>
  | Readonly<{ kind: 'refused' }>;

function streamHeaders(
  workspaceId: string | null,
  lastEventId: string | null,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;
  return headers;
}

export function openSseStream({
  url,
  method,
  workspaceId,
  lastEventId,
  signal,
}: Readonly<{
  url: string;
  method: 'GET' | 'POST';
  workspaceId: string | null;
  lastEventId: string | null;
  signal: AbortSignal;
}>): Promise<Response> {
  return fetch(url, {
    method,
    headers: streamHeaders(workspaceId, lastEventId),
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
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

export function useSseEventStream({
  enabled,
  url,
  workspaceId,
  invalidateDebounceMs,
  reconnectBaseMs,
  reconnectMaxMs,
  onFrame,
  onInvalidate,
}: SseEventStreamOptions): void {
  useEffect(() => {
    if (!enabled || !url) return;

    const controller = new AbortController();
    let cancelled = false;
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
      const response = await openSseStream({
        url,
        method: 'GET',
        workspaceId,
        lastEventId: stream.lastEventId,
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
      const outcome = await connect().catch((): StreamOutcome => ({ kind: 'dropped' }));
      if (cancelled || controller.signal.aborted) return;
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
    url,
    workspaceId,
  ]);
}
