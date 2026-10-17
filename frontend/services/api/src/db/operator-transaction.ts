import type { Database } from './database.ts';

class PreviewRollback<T> extends Error {
  readonly result: T;
  constructor(result: T) {
    super('Operator preview');
    this.result = result;
  }
}

/** Exercise the real mutation and roll back its evidence in preview mode. */
export async function operatorTransaction<T>(
  db: Database,
  apply: boolean,
  mutate: (trx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction().execute(async (trx) => {
      const result = await mutate(trx);
      if (!apply) throw new PreviewRollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.result as T;
    throw error;
  }
}
