import { describe, expect, it } from 'vite-plus/test';

import { retryAfterSeconds } from './retry-after';

const now = Date.parse('2026-11-13T12:00:00Z');

describe('Retry-After', () => {
  it.each([
    ['7', 7],
    [' 12 ', 12],
    ['1.5', 1.5],
    ['Fri, 13 Nov 2026 12:00:30 GMT', 30],
  ])('reads %j as a %d second wait', (header, seconds) => {
    expect(retryAfterSeconds(header, now)).toBe(seconds);
  });

  // Each of these once meant "retry now" to the answer-engine client.
  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['0'],
    ['-5'],
    ['soon'],
    ['Fri, 13 Nov 2026 11:59:00 GMT'],
  ])('gives no advice for %j, so the caller backs off', (header) => {
    expect(retryAfterSeconds(header, now)).toBeUndefined();
  });

  it('never reads a bare number as a calendar year', () => {
    expect(retryAfterSeconds('2030', now)).toBe(2030);
  });
});
