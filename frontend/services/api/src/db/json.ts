import { sql } from 'kysely';
import type { Json } from '../generated/db-schema.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export const numberRecord = (value: unknown): Record<string, number> =>
  Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );

export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const plainJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)); // NOSONAR

export function jsonObject(value: unknown, column: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new TypeError(`${column} is not a JSON object`);
}

export function jsonObjects(value: unknown, column: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${column} is not a JSON array`);
  return value.map((item) => jsonObject(item, `${column} item`));
}

export const providerMetadataWithoutRawBody = (column: string) =>
  sql<Json | null>`${sql.ref(column)} - 'raw_body'`.as('provider_metadata');
