import { heartbeatFailureLimit } from '../config/execution.ts';

export function leaseSignal(lease: AbortSignal, signal?: AbortSignal | null): AbortSignal {
  return signal ? AbortSignal.any([lease, signal]) : lease;
}

export function maintainLease(
  renew: () => Promise<boolean>,
  intervalMs: number,
  onError: (error: unknown) => void = () => undefined,
) {
  const abort = new AbortController();
  let failures = 0;
  let pending: Promise<void> | undefined;
  const lose = () => {
    clearInterval(timer);
    abort.abort();
  };
  const timer = setInterval(() => {
    if (pending || abort.signal.aborted) return;
    pending = Promise.resolve()
      .then(renew)
      .then((live) => {
        failures = 0;
        if (!live) lose();
      })
      .catch((error: unknown) => {
        failures++;
        if (failures >= heartbeatFailureLimit) lose();
        onError(error);
      })
      .finally(() => {
        pending = undefined;
      });
  }, intervalMs);
  return {
    signal: abort.signal,
    async stop() {
      clearInterval(timer);
      await pending;
    },
  };
}
