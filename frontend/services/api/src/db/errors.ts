/** PostgreSQL error classification for writers that map a race to an API error. */

/** A unique-constraint violation (SQLSTATE 23505), optionally on one named index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && (constraint === undefined || violated === constraint);
}

/** A value the schema refuses (SQLSTATE class 22 data exception or 23 integrity violation). */
export function isDataError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && /^2[23]/u.test(code);
}
