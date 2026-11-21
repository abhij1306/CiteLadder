import { ConfigError } from './config-error.ts';
import { epochMicros, parseDatetime } from '../http/datetimes.ts';

export type Env = Readonly<Record<string, string | undefined>>;

export type SettingSpec = {
  env: string[];
  type: string;
  default: unknown;
  values?: unknown[];
  minimum?: number;
  exclusive_minimum?: number;
  maximum?: number;
  exclusive_maximum?: number;
};

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
  // A naive timestamp is kept as "present but unusable"; demo access then
  // fails closed exactly as `demo_access_expired` does for a naive value.
  if (parsed.offsetSeconds === null) return new Date(Number.NaN);
  return new Date(Number(epochMicros(parsed) / 1000n));
}

function parseSetting(name: string, spec: SettingSpec, raw: string): unknown {
  switch (spec.type) {
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
    default:
      return raw;
  }
}

function resolveFromEnv(name: string, spec: SettingSpec, env: Env): unknown {
  const raw = envValue(spec, env);
  return raw === undefined ? spec.default : parseSetting(name, spec, raw);
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

  of(spec: SettingSpec): unknown {
    if (!this.#values.has(spec)) {
      throw new ConfigError(`${spec.env[0] ?? 'setting'} is not a catalogued setting`);
    }
    return this.#values.get(spec);
  }
}

export type SettingSource = Settings | Env;

export function resolveSpec(name: string, spec: SettingSpec, source: SettingSource): unknown {
  return source instanceof Settings ? source.of(spec) : resolveFromEnv(name, spec, source);
}

export function resolveSettingSpec(spec: SettingSpec, source: SettingSource): unknown {
  return resolveSpec(spec.env[0] ?? 'setting', spec, source);
}
