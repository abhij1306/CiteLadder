export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const numberRecord = (value: unknown): Record<string, number> =>
  Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );

export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const plainJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)); // NOSONAR -- the JSON round-trip is the point; structuredClone keeps undefined and Dates

export function jsonObject(value: unknown, column: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new TypeError(`${column} is not a JSON object`);
}

export function jsonObjects(value: unknown, column: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${column} is not a JSON array`);
  return value.map((item) => jsonObject(item, `${column} item`));
}
