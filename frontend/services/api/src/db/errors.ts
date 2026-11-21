function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (sqlState(error) !== '23505') return false;
  if (constraint === undefined) return true;
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? error.constraint === constraint
    : false;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return sqlState(error) === '23503';
}

export function isDataError(error: unknown): boolean {
  return /^2[23]/u.test(sqlState(error) ?? '');
}

const CONTENTION_STATES: ReadonlySet<string> = new Set(['40001', '40P01', '55P03']);

export function isRetryableContention(error: unknown): boolean {
  return CONTENTION_STATES.has(sqlState(error) ?? '');
}
