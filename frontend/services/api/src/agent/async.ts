/** Bound injected adapters even if they ignore cancellation. Late work cannot
 * escape the persistence fences; adapters must honor the signal to stop I/O. */
export async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work(), stopped]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
