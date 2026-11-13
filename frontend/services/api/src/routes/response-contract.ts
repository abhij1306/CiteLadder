/**
 * The runtime half of a JSON route's response contract. The compiler checks
 * a handler's return type, but a spread database row still type-checks while
 * carrying columns the contract never declared. Under `APP_ENV=test` every
 * response is parsed against its schema as the client receives it, and a
 * field the schema does not declare fails the request.
 */
import type { z } from 'zod';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Paths of `wire` fields the parse stripped, so the schema never declared them. */
function undeclared(wire: unknown, parsed: unknown, path: string): string[] {
  if (Array.isArray(wire))
    return Array.isArray(parsed)
      ? wire.flatMap((item, index) => undeclared(item, parsed[index], `${path}[${index}]`))
      : [];
  if (!isRecord(wire) || !isRecord(parsed)) return [];
  return Object.entries(wire).flatMap(([key, value]) =>
    Object.hasOwn(parsed, key)
      ? undeclared(value, parsed[key], `${path}.${key}`)
      : [`${path}.${key}`],
  );
}

/** Throws unless `body`, serialized as JSON, parses against `schema` with no undeclared field. */
export function assertResponseContract(schema: z.ZodType, body: unknown, route: string): void {
  // The wire form, not a clone: Dates become strings and undefined fields drop.
  const wire: unknown = body === undefined ? null : JSON.parse(JSON.stringify(body)); // NOSONAR -- structuredClone would keep Dates and undefined fields.
  const result = schema.safeParse(wire);
  if (!result.success)
    throw new Error(`The response of ${route} breaks its contract: ${result.error.message}`);
  const leaked = undeclared(wire, result.data, '$');
  if (leaked.length)
    throw new Error(`The response of ${route} carries undeclared fields: ${leaked.join(', ')}`);
}
