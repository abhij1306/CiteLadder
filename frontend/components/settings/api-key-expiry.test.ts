import { expect, it } from 'vite-plus/test';

import { addDays, dayInZone, presetLabelDate, resolveExpiry } from './api-key-expiry';

it('ends each preset at midnight in the display zone, counted from that zone’s today', () => {
  const at = (choice: '1' | '7' | '30' | '90', today: string, timeZone: string) =>
    resolveExpiry({ choice, customDay: '', today, timeZone });
  expect(at('30', '2026-11-22', 'Asia/Kolkata')).toEqual({
    kind: 'at',
    expiresAt: '2026-12-22T18:29:59.000Z',
  });
  expect(at('1', '2026-12-31', 'UTC')).toEqual({
    kind: 'at',
    expiresAt: '2027-01-01T23:59:59.000Z',
  });
  expect(at('7', '2026-02-25', 'UTC')).toEqual({
    kind: 'at',
    expiresAt: '2026-03-04T23:59:59.000Z',
  });
  expect(at('90', '2026-11-22', 'America/New_York')).toEqual({
    kind: 'at',
    expiresAt: '2027-02-21T04:59:59.000Z',
  });
  expect(dayInZone(new Date('2026-11-22T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-23');
  expect(dayInZone(new Date('2026-11-22T20:00:00Z'), 'America/Los_Angeles')).toBe('2026-11-22');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
});

it('refuses a custom day before today and accepts today itself', () => {
  const custom = (customDay: string) =>
    resolveExpiry({ choice: 'custom', customDay, today: '2026-11-22', timeZone: 'UTC' });
  expect(custom('2026-11-21')).toEqual({
    kind: 'invalid',
    message: 'Choose today or a later date.',
  });
  expect(custom('2026-11-22')).toEqual({ kind: 'at', expiresAt: '2026-11-22T23:59:59.000Z' });
  expect(custom('2026-02-30')).toEqual({ kind: 'invalid', message: 'Enter a date as YYYY-MM-DD.' });
  expect(
    resolveExpiry({ choice: 'never', customDay: '', today: '2026-11-22', timeZone: 'UTC' }),
  ).toEqual({ kind: 'never' });
});

it('names a preset’s weekday and adds the year only when it differs from today’s', () => {
  expect(presetLabelDate('2026-12-22', '2026-11-22')).toBe('Tue, Dec 22');
  expect(presetLabelDate('2027-02-20', '2026-11-22')).toBe('Sat, Feb 20, 2027');
});
