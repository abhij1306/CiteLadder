import { absent, type Formatted, percentText } from '@/lib/format';

export const rate = (value: unknown): Formatted =>
  typeof value === 'number' ? percentText(value) : absent('unavailable');

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
function parsed(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export const day = (value: unknown, fallback = 'Unknown date') => {
  const instant = parsed(value);
  return instant ? dayFormat.format(instant) : fallback;
};

export const moment = (value: unknown, fallback = 'Unknown time') => {
  const instant = parsed(value);
  return instant ? timeFormat.format(instant) : fallback;
};
