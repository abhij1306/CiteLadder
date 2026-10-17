/** ISO request timestamps retain PostgreSQL microsecond precision. */
import { z } from 'zod';

/** A parsed `datetime`: wall-clock fields plus the UTC offset, if any. */
export type ParsedDatetime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  microsecond: number;
  /** Offset from UTC in seconds, or null for a naive value. */
  offsetSeconds: number | null;
};

const MICROSECONDS_PER_SECOND = 1_000_000n;
const SECONDS_PER_DAY = 86_400;

// PostgreSQL calendar timestamps have no year zero.
const dateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'));
const datetimeSchema = z.iso
  .datetime({ offset: true, local: true })
  .refine((value) => !value.startsWith('0000-'));
// `date[Ttime[offset]]`, matched part by part; the schemas above validate ranges.
const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/u;
const TIME_PART = /^T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/u;
const OFFSET_PART = /^(?:(Z)|([+-])(\d{2}):(\d{2}))?$/u;

/** The date, time and offset captures of an ISO value, or null when malformed. */
function datetimeParts(text: string) {
  const date = DATE_PART.exec(text);
  if (!date) return null;
  const rest = text.slice(date[0].length);
  const time = rest ? TIME_PART.exec(rest) : null;
  if (rest && !time) return null;
  const zone = OFFSET_PART.exec(time ? rest.slice(time[0].length) : '');
  return zone ? { date, time, zone } : null;
}

/** `YYYY-MM-DD` for a real calendar date, or null. */
export function parseDate(text: string): string | null {
  return dateSchema.safeParse(text).success ? text : null;
}

/** Date inputs may carry an ISO midnight; a nonzero time cannot be discarded. */
export function parseRequestDate(text: string): string | null {
  const day = parseDate(text);
  if (day) return day;
  const instant = parseDatetime(text);
  return instant?.hour === 0 &&
    instant.minute === 0 &&
    instant.second === 0 &&
    instant.microsecond === 0
    ? text.slice(0, 10)
    : null;
}

/** An ISO date or datetime, or null when it is malformed or out of range. */
export function parseDatetime(text: string): ParsedDatetime | null {
  if (!dateSchema.safeParse(text).success && !datetimeSchema.safeParse(text).success) return null;
  const parts = datetimeParts(text);
  if (!parts) return null;
  const [, y, mo, d] = parts.date;
  const [, h, mi, s, fraction] = parts.time ?? [];
  const [, zulu, sign, tzHours, tzMinutes] = parts.zone;
  const [year, month, day] = [Number(y), Number(mo), Number(d)];
  const [hour, minute, second] = [Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0)];
  // PostgreSQL comparisons retain the first six fractional digits.
  const microsecond = fraction ? Number(fraction.slice(0, 6).padEnd(6, '0')) : 0;
  let offsetSeconds: number | null = null;
  if (zulu) offsetSeconds = 0;
  else if (sign) {
    if (Number(tzMinutes) > 59) return null;
    const total = Number(tzHours) * 3600 + Number(tzMinutes) * 60;
    if (total >= SECONDS_PER_DAY) return null;
    offsetSeconds = sign === '-' ? -total : total;
  }
  return { year, month, day, hour, minute, second, microsecond, offsetSeconds };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** ISO serialization without losing sub-millisecond precision. */
export function isoformat(value: ParsedDatetime): string {
  const date = `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)}`;
  const time = `${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;
  const micro = value.microsecond ? `.${pad(value.microsecond, 6)}` : '';
  if (value.offsetSeconds === null) return `${date}T${time}${micro}`;
  const sign = value.offsetSeconds < 0 ? '-' : '+';
  const minutes = Math.abs(value.offsetSeconds) / 60;
  return `${date}T${time}${micro}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Microseconds since the epoch in UTC; a naive value reads as UTC. */
export function epochMicros(value: ParsedDatetime): bigint {
  // `setUTCFullYear`, because `Date.UTC` reads years 0-99 as 1900-1999.
  const wall = new Date(0);
  wall.setUTCFullYear(value.year, value.month - 1, value.day);
  wall.setUTCHours(value.hour, value.minute, value.second, 0);
  const shifted = BigInt(wall.getTime()) * 1000n + BigInt(value.microsecond);
  return shifted - BigInt(value.offsetSeconds ?? 0) * MICROSECONDS_PER_SECOND;
}

/** The UTC instant `micros` microseconds after the epoch. */
export function fromEpochMicros(micros: bigint): ParsedDatetime {
  const seconds =
    micros / MICROSECONDS_PER_SECOND - (micros % MICROSECONDS_PER_SECOND < 0n ? 1n : 0n);
  const instant = new Date(Number(seconds) * 1000);
  return {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
    hour: instant.getUTCHours(),
    minute: instant.getUTCMinutes(),
    second: instant.getUTCSeconds(),
    microsecond: Number(micros - seconds * MICROSECONDS_PER_SECOND),
    offsetSeconds: 0,
  };
}

/** The value converted to UTC, preserving microseconds. */
export function toUtc(value: ParsedDatetime): ParsedDatetime {
  return fromEpochMicros(epochMicros(value));
}
