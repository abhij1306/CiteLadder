/** Calendar-day arithmetic over `YYYY-MM-DD` text, in UTC unless a time zone is named. */
/** Milliseconds in a UTC day. */
export const DAY_MS = 86_400_000;

/** Midnight UTC on `day`. */
export const dayStart = (day: string) => new Date(`${day}T00:00:00Z`);
/** The UTC calendar day of `date`. */
export const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** The day `days` after `day` (before it when negative). */
export function addDays(day: string, days: number): string {
  return utcDay(new Date(dayStart(day).getTime() + days * DAY_MS));
}

/** Days from `start` through `end`, both included. */
export const inclusiveDays = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / DAY_MS + 1;

const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** The calendar day of `at` in the IANA `timeZone`. */
export function reportingDay(at: Date, timeZone: string) {
  if (timeZone === 'UTC') return at.toISOString().slice(0, 10);
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(at);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
