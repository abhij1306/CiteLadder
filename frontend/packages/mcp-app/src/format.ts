export const rate = (value: unknown) =>
  typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'Unavailable';

export const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

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

/** "3 Oct 2026"; persisted timestamps are shown as dates, never as raw strings. */
export const day = (value: unknown, fallback = 'Unknown date') => {
  const instant = parsed(value);
  return instant ? dayFormat.format(instant) : fallback;
};

/** "3 Oct 2026, 14:05" in the viewer's time zone. */
export const moment = (value: unknown, fallback = 'Unknown time') => {
  const instant = parsed(value);
  return instant ? timeFormat.format(instant) : fallback;
};
