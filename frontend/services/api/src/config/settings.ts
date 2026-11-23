import { z } from 'zod';
import { ConfigError } from './config-error.ts';
import { epochMicros, parseDatetime } from '../http/datetimes.ts';

export type Env = Readonly<Record<string, string | undefined>>;

export const settingSpecSchema = z.object({
  env: z.array(z.string()),
  type: z.string(),
  default: z.unknown(),
  values: z.array(z.unknown()).optional(),
  minimum: z.number().optional(),
  exclusive_minimum: z.number().optional(),
  maximum: z.number().optional(),
  exclusive_maximum: z.number().optional(),
});

export type SettingSpec = z.infer<typeof settingSpecSchema>;

const settingTypeSchema = z.enum(['int', 'float', 'bool', 'datetime', 'literal', 'str', 'decimal']);

const TRUE_VALUES = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_VALUES = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

function envValue(spec: SettingSpec, env: Env): string | undefined {
  const byLowerName = new Map(
    Object.entries(env).map(([name, value]) => [name.toLowerCase(), value]),
  );
  for (const name of spec.env) {
    const value = byLowerName.get(name.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function checkBounds(name: string, value: number, spec: SettingSpec): number {
  if (spec.exclusive_minimum !== undefined && value <= spec.exclusive_minimum) {
    throw new ConfigError(`${name} must be > ${spec.exclusive_minimum}`);
  }
  if (spec.minimum !== undefined && value < spec.minimum) {
    throw new ConfigError(`${name} must be >= ${spec.minimum}`);
  }
  if (spec.maximum !== undefined && value > spec.maximum) {
    throw new ConfigError(`${name} must be <= ${spec.maximum}`);
  }
  if (spec.exclusive_maximum !== undefined && value >= spec.exclusive_maximum) {
    throw new ConfigError(`${name} must be < ${spec.exclusive_maximum}`);
  }
  return value;
}

function parseInteger(name: string, raw: string, spec: SettingSpec): number {
  if (!/^[+-]?\d+$/u.test(raw.trim())) throw new ConfigError(`${name} must be an integer`);
  return checkBounds(name, Number(raw.trim()), spec);
}

function parseFloatSetting(name: string, raw: string, spec: SettingSpec): number {
  const value = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(value)) throw new ConfigError(`${name} must be a number`);
  return checkBounds(name, value, spec);
}

function parseBoolean(name: string, raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new ConfigError(`${name} must be a boolean`);
}

function parseDatetimeSetting(name: string, raw: string): Date | null {
  if (!raw.trim()) return null;
  const parsed = parseDatetime(raw.trim());
  if (parsed === null) throw new ConfigError(`${name} must be a timestamp`);
  if (parsed.offsetSeconds === null) return new Date(Number.NaN);
  return new Date(Number(epochMicros(parsed) / 1000n));
}

function settingType(name: string, spec: SettingSpec) {
  const parsed = settingTypeSchema.safeParse(spec.type);
  if (!parsed.success) throw new ConfigError(`${name} has an unknown setting type ${spec.type}`);
  return parsed.data;
}

function parseSetting(name: string, spec: SettingSpec, raw: string): unknown {
  const type = settingType(name, spec);
  switch (type) {
    case 'int':
      return parseInteger(name, raw, spec);
    case 'float':
      return parseFloatSetting(name, raw, spec);
    case 'bool':
      return parseBoolean(name, raw);
    case 'datetime':
      return parseDatetimeSetting(name, raw);
    case 'literal':
      if (!spec.values?.includes(raw)) {
        throw new ConfigError(`${name} must be one of ${spec.values?.join(', ')}`);
      }
      return raw;
    case 'str':
    case 'decimal':
      return raw;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

export type SettingValue<S extends SettingSpec> = S['default'] extends number
  ? number
  : S['default'] extends boolean
    ? boolean
    : S['default'] extends string
      ? string
      : unknown;

function resolveFromEnv(name: string, spec: SettingSpec, env: Env): unknown {
  settingType(name, spec);
  const raw = envValue(spec, env);
  const value = raw === undefined ? spec.default : parseSetting(name, spec, raw);
  const expected = typeof spec.default;
  if (
    (expected === 'number' || expected === 'boolean' || expected === 'string') &&
    typeof value !== expected
  )
    throw new ConfigError(`${name} must be a ${expected}`);
  return value;
}

export class Settings {
  readonly #values: ReadonlyMap<SettingSpec, unknown>;

  constructor(catalog: Iterable<readonly [string, SettingSpec]>, env: Env) {
    const values = new Map<SettingSpec, unknown>();
    for (const [name, spec] of catalog) {
      if (!values.has(spec)) values.set(spec, resolveFromEnv(name, spec, env));
    }
    this.#values = values;
  }

  of<S extends SettingSpec>(spec: S): SettingValue<S>;
  of(spec: SettingSpec): unknown {
    if (!this.#values.has(spec)) {
      throw new ConfigError(`${spec.env[0] ?? 'setting'} is not a catalogued setting`);
    }
    return this.#values.get(spec);
  }
}

export type SettingSource = Settings | Env;

export function resolveSpec<S extends SettingSpec>(
  name: string,
  spec: S,
  source: SettingSource,
): SettingValue<S>;
export function resolveSpec(name: string, spec: SettingSpec, source: SettingSource): unknown {
  return source instanceof Settings ? source.of(spec) : resolveFromEnv(name, spec, source);
}

export function resolveSettingSpec<S extends SettingSpec>(
  spec: S,
  source: SettingSource,
): SettingValue<S>;
export function resolveSettingSpec(spec: SettingSpec, source: SettingSource): unknown {
  return resolveSpec(spec.env[0] ?? 'setting', spec, source);
}

export function settingValues<T extends Record<string, SettingSpec>>(
  specs: T,
  source: SettingSource,
): { [K in keyof T]: SettingValue<T[K]> };
export function settingValues(
  specs: Record<string, SettingSpec>,
  source: SettingSource,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [name, resolveSpec(name, spec, source)]),
  );
}

export function dateSetting(spec: SettingSpec, source: SettingSource): Date | null {
  const value = resolveSettingSpec(spec, source);
  if (value === null || value instanceof Date) return value;
  throw new ConfigError(`${spec.env[0] ?? 'setting'} must be a timestamp`);
}

export function nullableTextSetting(spec: SettingSpec, source: SettingSource): string | null {
  const value = resolveSettingSpec(spec, source);
  if (value === null || typeof value === 'string') return value;
  throw new ConfigError(`${spec.env[0] ?? 'setting'} must be text`);
}

export function choiceSetting<const T extends string>(
  spec: SettingSpec & { default: string },
  source: SettingSource,
  choices: readonly T[],
): T {
  const value = resolveSettingSpec(spec, source);
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined)
    throw new ConfigError(`${spec.env[0] ?? 'setting'} must be one of ${choices.join(', ')}`);
  return choice;
}
