/**
 * Path and query parameters, validated into the published 422 contract.
 *
 * Every parameter failure is
 * collected, path parameters first, and answered with the envelope the
 * API publishes: `code: validation_error`,
 * `details.errors[{loc, message, type}]` and the first error as the message.
 * `loc` and `type` are the contract; messages are human-readable and not
 * a stable text. Repeated keys take the last value (every value
 * for a list), and an empty value is validated, never treated as absent.
 */
import { ApiError } from '../errors.ts';
import { parseRequestDate, parseDatetime, type ParsedDatetime } from './datetimes.ts';
import { parseUuid } from './uuid.ts';
import { isNonEmpty, lastOf } from '../lists.ts';

type Scalar =
  | { kind: 'uuid' }
  | { kind: 'date' }
  | { kind: 'datetime' }
  | { kind: 'int'; ge?: number; le?: number }
  | { kind: 'float' }
  | { kind: 'bool' }
  | { kind: 'str'; minLength?: number; maxLength?: number }
  | { kind: 'literal'; values: readonly string[] };

type ScalarValue<S extends Scalar> = S extends { kind: 'datetime' }
  ? ParsedDatetime
  : S extends { kind: 'int' | 'float' }
    ? number
    : S extends { kind: 'bool' }
      ? boolean
      : S extends { kind: 'literal'; values: readonly (infer V)[] }
        ? V
        : string;

export type ParamSpec = {
  scalar: Scalar;
  /** The wire name, when it differs from the parameter name. */
  alias?: string;
  list?: boolean;
  required?: boolean;
  default?: unknown;
};

type SpecValue<P extends ParamSpec> = P extends { list: true }
  ? ScalarValue<P['scalar']>[] | null
  : P extends { required: true }
    ? ScalarValue<P['scalar']>
    : P extends { default: infer D }
      ? ScalarValue<P['scalar']> | Exclude<D, undefined>
      : ScalarValue<P['scalar']> | null;

export type ParamSpecs = Readonly<Record<string, ParamSpec>>;
type ParamValues<Specs extends ParamSpecs> = {
  -readonly [K in keyof Specs]: SpecValue<Specs[K]>;
};

export type ValidationEntry = { loc: string[]; message: string; type: string };

type Outcome = { ok: true; value: unknown } | { ok: false; type: string; message: string };

export const UUID_MESSAGE = 'Expected a UUID';

const failure = (type: string, message: string): Outcome => ({ ok: false, type, message });

function validateInt(scalar: Extract<Scalar, { kind: 'int' }>, raw: string): Outcome {
  const text = raw.trim();
  if (!/^[+-]?\d+$/u.test(text) || !Number.isSafeInteger(Number(text)))
    return failure('int_parsing', 'Expected a safe integer');
  const value = Number(text);
  if (scalar.ge !== undefined && value < scalar.ge) {
    return failure('greater_than_equal', `Must be at least ${scalar.ge}`);
  }
  if (scalar.le !== undefined && value > scalar.le) {
    return failure('less_than_equal', `Must be at most ${scalar.le}`);
  }
  return { ok: true, value };
}

// Decimal notation only: `Number` would also read hex, octal and binary literals.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;

function validateFloat(raw: string): Outcome {
  const text = raw.trim();
  const value = DECIMAL.test(text) ? Number(text) : Number.NaN;
  return Number.isFinite(value)
    ? { ok: true, value }
    : failure('float_parsing', 'Expected a finite number');
}

// Accepted boolean query spellings.
const TRUE_WORDS = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_WORDS = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

function validateBool(raw: string): Outcome {
  const text = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return { ok: true, value: true };
  if (FALSE_WORDS.has(text)) return { ok: true, value: false };
  return failure('bool_parsing', 'Expected a boolean');
}

function validateStr(scalar: Extract<Scalar, { kind: 'str' }>, raw: string): Outcome {
  // Lengths count code points, not UTF-16 units.
  const length = [...raw].length;
  if (scalar.minLength !== undefined && length < scalar.minLength) {
    return failure('string_too_short', `Must contain at least ${scalar.minLength} characters`);
  }
  if (scalar.maxLength !== undefined && length > scalar.maxLength) {
    return failure('string_too_long', `Must contain at most ${scalar.maxLength} characters`);
  }
  return { ok: true, value: raw };
}

function validateScalar(scalar: Scalar, raw: string): Outcome {
  switch (scalar.kind) {
    case 'uuid': {
      const value = parseUuid(raw);
      return value === null ? failure('uuid_parsing', UUID_MESSAGE) : { ok: true, value };
    }
    case 'date': {
      const value = parseRequestDate(raw);
      return value === null
        ? failure('date_parsing', 'Expected a date in YYYY-MM-DD format')
        : { ok: true, value };
    }
    case 'datetime': {
      const value = parseDatetime(raw);
      return value === null
        ? failure('datetime_parsing', 'Expected an ISO 8601 date or datetime')
        : { ok: true, value };
    }
    case 'int':
      return validateInt(scalar, raw);
    case 'float':
      return validateFloat(raw);
    case 'bool':
      return validateBool(raw);
    case 'str':
      return validateStr(scalar, raw);
    case 'literal':
      return scalar.values.includes(raw)
        ? { ok: true, value: raw }
        : failure('literal_error', `Expected one of: ${scalar.values.join(', ')}`);
  }
}

/** Read one declared parameter from the raw request values. */
function readParam(
  name: string,
  spec: ParamSpec,
  all: (key: string) => string[],
  errors: ValidationEntry[],
): unknown {
  const key = spec.alias ?? name;
  const received = all(key);
  if (!isNonEmpty(received)) {
    if (spec.required) errors.push({ loc: [key], message: 'Required', type: 'missing' });
    return spec.default ?? null;
  }
  if (spec.list) {
    const values: unknown[] = [];
    received.forEach((raw, index) => {
      const outcome = validateScalar(spec.scalar, raw);
      if (outcome.ok) values.push(outcome.value);
      else errors.push({ loc: [key, String(index)], message: outcome.message, type: outcome.type });
    });
    return values;
  }
  const outcome = validateScalar(spec.scalar, lastOf(received));
  if (outcome.ok) return outcome.value;
  errors.push({ loc: [key], message: outcome.message, type: outcome.type });
  return null;
}

function read<Specs extends ParamSpecs>(
  specs: Specs,
  all: (key: string) => string[],
  errors: ValidationEntry[],
): ParamValues<Specs> {
  const values: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    values[name] = readParam(name, spec, all, errors);
  }
  return values as ParamValues<Specs>;
}

export class RequestValidationError extends ApiError {
  constructor(errors: ValidationEntry[]) {
    const [first] = errors;
    const message = first ? `${first.loc.join('.')}: ${first.message}` : 'Invalid request';
    super(422, message, { details: { errors }, retryable: false });
  }
}

export type RequestParams<Path extends ParamSpecs, Query extends ParamSpecs> = {
  path: ParamValues<Path>;
  query: ParamValues<Query>;
};

/**
 * Validate one request's path and query parameters, or throw the 422.
 * `search` is the raw query string, decoded by URLSearchParams.
 */
export function validateParams<Path extends ParamSpecs, Query extends ParamSpecs>(
  specs: { path: Path; query: Query },
  input: { path: Readonly<Record<string, string>>; search: string },
): RequestParams<Path, Query> {
  const errors: ValidationEntry[] = [];
  const path = read(specs.path, (key) => (key in input.path ? [input.path[key]!] : []), errors);
  const params = new URLSearchParams(input.search);
  const query = read(specs.query, (key) => params.getAll(key), errors);
  if (errors.length > 0) throw new RequestValidationError(errors);
  return { path, query };
}
