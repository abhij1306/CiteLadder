import type { Selectable } from 'kysely';
import type { AuditSchedules } from '../generated/db-schema.ts';

type Cadence = Pick<
  Selectable<AuditSchedules>,
  'cadence' | 'next_run_at' | 'timezone' | 'interval_minutes'
>;
const formatters = new Map<string, Intl.DateTimeFormat>();
function localTime(instant: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    ((instant % 1000) + 1000) % 1000,
  );
}
/** ZoneInfo fold=0: first occurrence of ambiguous time; pre-transition offset for a missing local time. */
function inZone(local: number, zone: string) {
  const surrounding = [local - 2 * 86400000, local, local + 2 * 86400000];
  const offsets = [...new Set(surrounding.map((instant) => localTime(instant, zone) - instant))];
  const candidates = offsets.map((offset) => local - offset);
  const exact = candidates.filter((instant) => localTime(instant, zone) === local);
  return exact.length ? Math.min(...exact) : Math.max(...candidates);
}
export function nextRunAfter(schedule: Cadence, after: Date): Date | null {
  if (schedule.cadence === 'one_time') return null;
  const anchor = (schedule.next_run_at ?? after).getTime(),
    now = after.getTime();
  if (schedule.cadence === 'every_n_minutes') {
    if (!schedule.interval_minutes || schedule.interval_minutes <= 0)
      throw new Error('every_n_minutes requires a positive interval');
    const delta = schedule.interval_minutes * 60000;
    return new Date(anchor + (Math.floor(Math.max(0, now - anchor) / delta) + 1) * delta);
  }
  const delta = { hourly: 3600000, daily: 86400000, weekly: 7 * 86400000 }[schedule.cadence];
  if (!delta) throw new Error('Unsupported audit schedule cadence');
  if (anchor > now) return new Date(anchor);
  const local = localTime(anchor, schedule.timezone),
    afterLocal = localTime(now, schedule.timezone);
  let steps = Math.max(0, Math.floor((afterLocal - local) / delta));
  let candidate = inZone(local + steps * delta, schedule.timezone);
  while (candidate <= now) candidate = inZone(local + ++steps * delta, schedule.timezone);
  return new Date(candidate);
}
