/** Narrow persisted JSON columns to the shapes the views publish. */

/** A JSON object, or `{}` for any other value. */
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A JSON object's numeric entries. */
export const numberRecord = (value: unknown): Record<string, number> =>
  Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );

/** A JSON array's string items, or `[]` for any other value. */
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The value as plain JSON data: undefined drops and Dates become ISO strings. */
export const plainJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value)); // NOSONAR -- the JSON round-trip is the point; structuredClone keeps undefined and Dates

/** A stored JSON object; any other value is a corrupt row and fails loudly. */
export function jsonObject(value: unknown, column: string): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new TypeError(`${column} is not a JSON object`);
}

/** A stored JSON array of objects; any other value fails loudly. */
export function jsonObjects(value: unknown, column: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new TypeError(`${column} is not a JSON array`);
  return value.map((item) => jsonObject(item, `${column} item`));
}
