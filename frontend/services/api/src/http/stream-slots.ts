/**
 * Per-user cap on open Server-Sent Events streams, held in this API
 * instance's memory. Each instance enforces its own cap; a restart frees every
 * slot because the streams it held die with it.
 */
import type { ServiceConfig } from '../config.ts';
import { ApiError } from '../errors.ts';

type StreamLimits = Pick<
  ServiceConfig['auth']['limits'],
  'sse_streams_per_user' | 'active_job_retry_after_seconds'
>;

const openStreams = new Map<string, number>();

function acquire(userId: string, limits: StreamLimits): () => void {
  const open = openStreams.get(userId) ?? 0;
  if (open >= limits.sse_streams_per_user)
    throw new ApiError(429, 'Too many open event streams for this user', {
      headers: { 'retry-after': String(limits.active_job_retry_after_seconds) },
    });
  openStreams.set(userId, open + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const remaining = (openStreams.get(userId) ?? 1) - 1;
    if (remaining > 0) openStreams.set(userId, remaining);
    else openStreams.delete(userId);
  };
}

/**
 * Admit one event stream for the user or refuse with 429 before it starts.
 * The slot is released when the stream completes, errors, is cancelled, or
 * the request aborts, whichever happens first.
 */
export type StreamOwner = { userId: string; limits: StreamLimits };

export function slottedEventStream(
  input: StreamOwner & { signal: AbortSignal; open: () => ReadableStream<Uint8Array> },
): ReadableStream<Uint8Array> {
  const release = acquire(input.userId, input.limits);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = input.open().getReader();
  } catch (error) {
    release();
    throw error;
  }
  if (input.signal.aborted) release();
  else input.signal.addEventListener('abort', release, { once: true });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          release();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });
}
