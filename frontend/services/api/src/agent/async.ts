import type { KyselyPlugin } from 'kysely';
import type { Database } from '../db/database.ts';

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
