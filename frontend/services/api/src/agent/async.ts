import type { KyselyPlugin } from 'kysely';
import type { Database } from '../db/database.ts';

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

/**
 * The database as a read that `signal` can stop: once it aborts (the read
 * timeout, Stop or a lost lease), every later query, transactions included,
 * throws its reason instead of running. A query already sent finishes.
 */
export function stoppableReads(db: Database, signal: AbortSignal): Database {
  const stop: KyselyPlugin = {
    transformQuery: ({ node }) => {
      signal.throwIfAborted();
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  return db.withPlugin(stop);
}
