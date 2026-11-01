/**
 * How the Overview PDF prints persisted values. A missing value prints the
 * product's missing mark, never zero, and a missing comparison says so.
 */
import { engineLabel } from '../config/providers.ts';

/** The mark the app prints for a value that was not measured. */
export const MISSING = '–';

/** A 0–100 figure as the dashboard prints it: whole, or to one decimal. */
export const figure = (value: number | null | undefined, suffix = '') =>
  value == null ? MISSING : `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;

/** A 0–1 rate as a whole percent. */
export const rate = (value: number | null | undefined) =>
  value == null ? MISSING : `${Math.round(value * 100)}%`;

export const count = (value: number | null | undefined) =>
  value == null ? MISSING : value.toLocaleString('en-US');

export const plural = (value: number, noun: string, many = `${noun}s`) =>
  `${value.toLocaleString('en-US')} ${value === 1 ? noun : many}`;

/** A change in percentage points, signed. */
export function points(delta: number): string {
  if (delta === 0) return 'No change';
  return `${delta > 0 ? '+' : '−'}${figure(Math.abs(delta))} pts`;
}

const ORDINAL_SUFFIX: Readonly<Record<number, string>> = { 1: 'st', 2: 'nd', 3: 'rd' };
export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${ORDINAL_SUFFIX[value % 10] ?? 'th'}`;
}

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** "1 November 2026". */
export const longDate = (value: string | Date) => day.format(new Date(value));
/** "1 Nov 2026", for table cells. */
export const shortDate = (value: string | Date) => shortDay.format(new Date(value));
/** "1 November 2026, 09:00 UTC". */
export const dateTime = (value: string) =>
  `${day.format(new Date(value))}, ${clock.format(new Date(value))} UTC`;

const list = new Intl.ListFormat('en-GB', { type: 'conjunction' });
/** Engine keys as their catalogue names, as one phrase: "ChatGPT API and Claude API". */
export const engines = (keys: readonly string[]) =>
  list.format([...new Set(keys)].map(engineLabel));
