/**
 * Timestamps across the SQL boundary at microsecond precision.
 *
 * node-postgres parses `timestamptz` into a JavaScript `Date`, which drops the
 * microseconds PostgreSQL stores. Reads therefore select a timestamp as UTC
 * text and render the wire format (`2026-01-01T00:00:00Z`, `.ffffff` only
 * when non-zero); request timestamps travel back as ISO text cast in SQL.
 */
import { sql, type Expression, type RawBuilder } from 'kysely';

import { isoformat, toUtc, type ParsedDatetime } from '../http/datetimes.ts';

/** `value` as UTC text with microseconds, or NULL. */
export function utcText(value: Expression<unknown>): RawBuilder<string | null> {
  return sql<string | null>`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
}

/** `utcText` of a NOT NULL column. */
export const utcTextOf = (value: Expression<unknown>): RawBuilder<string> =>
  utcText(value) as RawBuilder<string>;

/** The wire format for a UTC instant, from `utcText` output. */
export function wireUtc(text: string): string {
  return `${text.endsWith('.000000') ? text.slice(0, -'.000000'.length) : text}Z`;
}

export function wireUtcOrNull(text: string | null): string | null {
  return text === null ? null : wireUtc(text);
}

/** The wire format for an aware instant, rendered in UTC. */
export function wireUtcOf(value: ParsedDatetime): string {
  return isoformat(toUtc(value)).replace(/\+00:00$/u, 'Z');
}

/** Stored `utcText` output as a `timestamptz` operand. */
export function storedInstant(text: string): RawBuilder<Date> {
  return sql<Date>`${text + 'Z'}::timestamptz`;
}

/** A parsed request timestamp as a `timestamptz` operand (naive reads as UTC). */
export function timestamptz(value: ParsedDatetime): RawBuilder<Date> {
  return sql<Date>`${isoformat(toUtc(value))}::timestamptz`;
}

/** A `date` column as `YYYY-MM-DD`, which is `date.isoformat()`. */
export function isoDateText(value: Expression<unknown>): RawBuilder<string> {
  return sql<string>`to_char(${value}, 'YYYY-MM-DD')`;
}

/** `datetime.isoformat()` of an aware UTC value, from `utcText` output. */
export function isoUtc(text: string): string {
  return `${text.endsWith('.000000') ? text.slice(0, -'.000000'.length) : text}+00:00`;
}

export function isoUtcOrNull(text: string | null): string | null {
  return text === null ? null : isoUtc(text);
}
