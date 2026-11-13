/** PostgreSQL error classification for writers that map a race to an API error. */

/** The SQLSTATE a PostgreSQL error carries, or null for anything else. */
function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

/** A unique-constraint violation (SQLSTATE 23505), optionally on one named index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (sqlState(error) !== '23505') return false;
  if (constraint === undefined) return true;
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? error.constraint === constraint
    : false;
}

/** A foreign-key violation (SQLSTATE 23503): the row is still referenced, or its parent is gone. */
export function isForeignKeyViolation(error: unknown): boolean {
  return sqlState(error) === '23503';
}

/** A value the schema refuses (SQLSTATE class 22 data exception or 23 integrity violation). */
export function isDataError(error: unknown): boolean {
  return /^2[23]/u.test(sqlState(error) ?? '');
}

// Serialization failure, deadlock and lock-not-available: the transaction lost
// a race and a fresh attempt can succeed.
const CONTENTION_STATES: ReadonlySet<string> = new Set(['40001', '40P01', '55P03']);

/** A transaction that lost to concurrent work and may be retried from the start. */
export function isRetryableContention(error: unknown): boolean {
  return CONTENTION_STATES.has(sqlState(error) ?? '');
}
