import { sql, type Expression, type RawBuilder } from 'kysely';

import { isoformat, toUtc, type ParsedDatetime } from '../http/datetimes.ts';

export function utcText(value: Expression<unknown>): RawBuilder<string | null> {
  return sql<string | null>`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
}

export const utcTextOf = (value: Expression<unknown>): RawBuilder<string> =>
  utcText(value) as RawBuilder<string>;

export function wireUtc(text: string): string {
  return `${text.endsWith('.000000') ? text.slice(0, -'.000000'.length) : text}Z`;
}

export function wireUtcOrNull(text: string | null): string | null {
  return text === null ? null : wireUtc(text);
}

export function wireUtcOf(value: ParsedDatetime): string {
  return isoformat(toUtc(value)).replace(/\+00:00$/u, 'Z');
}

export function storedInstant(text: string): RawBuilder<Date> {
  return sql<Date>`${text + 'Z'}::timestamptz`;
}

export function timestamptz(value: ParsedDatetime): RawBuilder<Date> {
  return sql<Date>`${isoformat(toUtc(value))}::timestamptz`;
}

export function isoDateText(value: Expression<unknown>): RawBuilder<string> {
  return sql<string>`to_char(${value}, 'YYYY-MM-DD')`;
}

export function isoUtc(text: string): string {
  return `${text.endsWith('.000000') ? text.slice(0, -'.000000'.length) : text}+00:00`;
}

export function isoUtcOrNull(text: string | null): string | null {
  return text === null ? null : isoUtc(text);
}
