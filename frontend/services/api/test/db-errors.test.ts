import { describe, expect, it } from 'vitest';

import {
  isDataError,
  isForeignKeyViolation,
  isRetryableContention,
  isUniqueViolation,
} from '../src/db/errors.ts';

const failure = (code: unknown, constraint?: string) =>
  Object.assign(new Error('database failure'), { code, constraint });

describe('PostgreSQL error classification', () => {
  it.each([
    ['40001', true],
    ['40P01', true],
    ['55P03', true],
    ['57014', false],
    ['23505', false],
  ])('classifies SQLSTATE %s as retryable contention: %s', (code, expected) => {
    expect(isRetryableContention(failure(code))).toBe(expected);
  });

  it('reads only a string SQLSTATE on an object', () => {
    expect(isRetryableContention({ code: '40P01' })).toBe(true);
    expect(isRetryableContention(failure(40001))).toBe(false);
    expect(isRetryableContention('40001')).toBe(false);
    expect(isRetryableContention(null)).toBe(false);
  });

  it('tells a foreign-key violation from other integrity failures', () => {
    expect(isForeignKeyViolation(failure('23503'))).toBe(true);
    expect(isForeignKeyViolation(failure('23505'))).toBe(false);
    expect(isDataError(failure('23503'))).toBe(true);
    expect(isDataError(failure('40001'))).toBe(false);
  });

  it('matches a unique violation on any index or only the named one', () => {
    const violation = failure('23505', 'users_email_key');
    expect(isUniqueViolation(violation)).toBe(true);
    expect(isUniqueViolation(violation, 'users_email_key')).toBe(true);
    expect(isUniqueViolation(violation, 'users_pkey')).toBe(false);
    expect(isUniqueViolation(failure('23503', 'users_email_key'), 'users_email_key')).toBe(false);
  });
});
