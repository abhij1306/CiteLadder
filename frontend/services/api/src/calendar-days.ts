/** UTC calendar-day arithmetic over `YYYY-MM-DD` text. */
const DAY_MS = 86_400_000;

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
