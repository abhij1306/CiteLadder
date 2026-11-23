import type { z } from 'zod';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

export function assertResponseContract(schema: z.ZodType, body: unknown, route: string): void {
  const wire: unknown = body === undefined ? null : JSON.parse(JSON.stringify(body)); // NOSONAR
  const result = schema.safeParse(wire);
  if (!result.success)
    throw new Error(`The response of ${route} breaks its contract: ${result.error.message}`);
  const leaked = undeclared(wire, result.data, '$');
  if (leaked.length)
    throw new Error(`The response of ${route} carries undeclared fields: ${leaked.join(', ')}`);
}
