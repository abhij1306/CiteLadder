/**
 * Per-user cap on open Server-Sent Events streams, held in this API
 * instance's memory. Each instance enforces its own cap; a restart frees every
 * slot because the streams it held die with it. A held stream also re-checks
 * its caller's access, so a removed member cannot keep one.
 */
import type { Context } from 'hono';

import { findWorkspaceMember } from '../auth/workspace.ts';
import type { ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';

type StreamLimits = Pick<
  ServiceConfig['auth']['limits'],
  'sse_streams_per_user' | 'active_job_retry_after_seconds' | 'sse_access_recheck_seconds'
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

/** Who holds a stream, and whether their access still stands. */
export type StreamOwner = {
  userId: string;
  limits: StreamLimits;
  stillAuthorized: () => Promise<boolean>;
};

/** The owner of a stream opened by this workspace-scoped request. */
export function streamOwner(c: Context<AppEnv>, db: Database, limits: StreamLimits): StreamOwner {
  const user = c.get('user'),
    workspaceId = c.get('workspace').workspaceId;
  return {
    userId: user.id,
    limits,
    stillAuthorized: async () =>
      (await findWorkspaceMember(db, user.id, workspaceId)) !== undefined,
  };
}

/**
 * Admit one event stream for the user or refuse with 429 before it starts.
 * The slot is released when the stream completes, errors, is cancelled, or
 * the request aborts, whichever happens first. Every recheck interval the
 * owner's access is read again; once it has ended (or cannot be confirmed)
 * the signal `open` received aborts and the stream closes, so the client's
 * reconnect goes through full authorization.
 */
export function slottedEventStream(
  input: StreamOwner & {
    signal: AbortSignal;
    open: (signal: AbortSignal) => ReadableStream<Uint8Array>;
  },
): ReadableStream<Uint8Array> {
  const releaseSlot = acquire(input.userId, input.limits);
  const accessEnded = new AbortController();
  const signal = AbortSignal.any([input.signal, accessEnded.signal]);
  const recheck = setInterval(() => {
    input.stillAuthorized().then(
      (authorized) => {
        if (!authorized) accessEnded.abort();
      },
      () => accessEnded.abort(),
    );
  }, input.limits.sse_access_recheck_seconds * 1000);
  const release = () => {
    clearInterval(recheck);
    releaseSlot();
  };
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = input.open(signal).getReader();
  } catch (error) {
    release();
    throw error;
  }
  if (signal.aborted) release();
  else signal.addEventListener('abort', release, { once: true });
  // Ended access closes the stream even if the inner one never finishes:
  // cancelling discards its queue and ends a pending read as done.
  accessEnded.signal.addEventListener(
    'abort',
    () => {
      reader.cancel().catch(() => {});
    },
    { once: true },
  );
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
