/**
 * Idempotency keys for Agent writes that start a paid turn.
 *
 * A retry of the SAME request after an ambiguous failure must reuse its key,
 * or a request the server already accepted runs a second time. A key is kept
 * until the request is accepted or its input changes.
 */
import { useRef } from 'react';

export const newIdempotencyKey = () => globalThis.crypto.randomUUID();

export function useRequestKey() {
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    keyFor(request: unknown): string {
      const fingerprint = JSON.stringify(request);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, key: newIdempotencyKey() };
      return pending.current.key;
    },
    accepted() {
      pending.current = null;
    },
  };
}
