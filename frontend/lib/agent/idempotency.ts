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
