import { engineLabel } from '../config/providers.ts';

export const MISSING = '–';

export function figure(value: number | null | undefined, suffix = '') {
  if (value == null) return MISSING;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${shown}${suffix}`;
}

export const rate = (value: number | null | undefined) =>
  value == null ? MISSING : `${Math.round(value * 100)}%`;

export const count = (value: number | null | undefined) =>
  value == null ? MISSING : value.toLocaleString('en-US');

export const plural = (value: number, noun: string, many = `${noun}s`) =>
  `${value.toLocaleString('en-US')} ${value === 1 ? noun : many}`;

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

export const longDate = (value: string | Date) => day.format(new Date(value));
export const shortDate = (value: string | Date) => shortDay.format(new Date(value));
export const dateTime = (value: string) =>
  `${day.format(new Date(value))}, ${clock.format(new Date(value))} UTC`;

const list = new Intl.ListFormat('en-GB', { type: 'conjunction' });
export const engines = (keys: readonly string[]) =>
  list.format([...new Set(keys)].map(engineLabel));
