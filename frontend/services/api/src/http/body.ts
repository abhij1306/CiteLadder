/** zod validation with the published status/code/location/type error contract. */
import type { Context } from 'hono';
import { z } from 'zod';
import { ApiError } from '../errors.ts';
import { RequestValidationError, type ValidationEntry } from './params.ts';
import { parseRequestDate } from './datetimes.ts';

const dateFields = new WeakMap<z.ZodType, Set<string>>();

/** Top-level `format: date` fields, derived once per schema. */
function datesOf(schema: z.ZodType): Set<string> {
  let fields = dateFields.get(schema);
  if (!fields) {
    const properties = z.toJSONSchema(schema, { io: 'input' }).properties ?? {};
    fields = new Set(
      Object.entries(properties)
        .filter(([, field]) => typeof field === 'object' && field.format === 'date')
        .map(([key]) => key),
    );
    dateFields.set(schema, fields);
  }
  return fields;
}

/** The published 422 `type` token for one zod issue at the received value `at`. */
function issueType(issue: z.core.$ZodIssue, at: unknown, dateField: boolean): string {
  if (at === undefined && issue.path.length > 0) return 'missing';
  const malformed = issue.code === 'invalid_type' || issue.code === 'invalid_format';
  if (at !== undefined && dateField && malformed)
    return typeof at === 'string' ? 'date_parsing' : 'date_type';
  switch (issue.code) {
    case 'invalid_type':
      if (at === undefined) return 'missing';
      return issue.expected === 'object' ? 'model_attributes_type' : `${issue.expected}_type`;
    case 'too_small':
      return 'string_too_short';
    case 'too_big':
      return 'string_too_long';
    case 'invalid_format':
      return issue.format === 'date' ? 'date_parsing' : 'value_error';
    case 'invalid_value':
      return 'literal_error';
    default:
      return 'value_error';
  }
}

export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const value = await readOptionalBody(c, schema);
  if (value === null)
    throw new RequestValidationError([{ loc: [], message: 'Field required', type: 'missing' }]);
  return value;
}

/** Whether the request declares a JSON body (`application/json`, any parameters such as charset). */
function declaresJson(c: Context): boolean {
  const media = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
  return media === 'application/json';
}

/**
 * An optional JSON body: empty or `null` reads as null. A non-empty body must
 * declare `Content-Type: application/json`, so a form or plain-text post that a
 * browser sends without a preflight never reaches a JSON route (415).
 */
export async function readOptionalBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.output<T> | null> {
  let value: unknown;
  const raw = await c.req.text();
  if (!raw) return null;
  if (!declaresJson(c)) throw new ApiError(415, 'Content-Type must be application/json');
  try {
    value = JSON.parse(raw);
  } catch (error) {
    // Keep the parser's input location, not its runtime-specific wording.
    const position =
      error instanceof SyntaxError ? /position (\d+)/u.exec(error.message)?.[1] : undefined;
    const offset = position === undefined ? raw.length : Number(position);
    throw new RequestValidationError([
      {
        loc: [String(Array.from(raw.slice(0, offset)).length)],
        message: 'Invalid JSON',
        type: 'json_invalid',
      },
    ]);
  }
  if (value === null) return null;
  const dates = datesOf(schema);
  const isDate = (key: string) => dates.has(key);
  if (value && typeof value === 'object' && !Array.isArray(value))
    value = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isDate(key) && typeof item === 'string' ? (parseRequestDate(item) ?? item) : item,
      ]),
    );
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const errors: ValidationEntry[] = result.error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys')
      return issue.keys.map((key) => ({
        loc: [...issue.path.map(String), key],
        message: issue.message,
        type: 'extra_forbidden',
      }));
    const at = issue.path.reduce<unknown>(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<PropertyKey, unknown>)[key]
          : undefined,
      value,
    );
    const type = issueType(issue, at, isDate(String(issue.path[0])));
    return [{ loc: issue.path.map(String), message: issue.message, type }];
  });
  throw new RequestValidationError(errors);
}
