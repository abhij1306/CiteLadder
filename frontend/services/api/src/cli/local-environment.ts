import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** Host tools share root .env -> process precedence; never print this object. */
export function localEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const values: Record<string, string | undefined> = {};
  if (!['1', 'true', 'yes', 'on'].includes(env.CITELADDER_DISABLE_DOTENV?.toLowerCase() ?? '')) {
    const path = fileURLToPath(new URL('../../../../../.env', import.meta.url));
    if (existsSync(path)) Object.assign(values, parseEnv(readFileSync(path, 'utf8')));
  }
  Object.assign(values, env);
  if (
    !values.DATABASE_URL &&
    [
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'POSTGRES_HOST',
      'POSTGRES_HOST_PORT',
    ].every((key) => values[key])
  ) {
    const host = values.POSTGRES_HOST!;
    const hostname = host.includes(':') ? `[${host}]` : host;
    values.DATABASE_URL = `postgresql://${encodeURIComponent(values.POSTGRES_USER!)}:${encodeURIComponent(values.POSTGRES_PASSWORD!)}@${hostname}:${values.POSTGRES_HOST_PORT}/${encodeURIComponent(values.POSTGRES_DB!)}`;
  }
  values.CITELADDER_DISABLE_DOTENV = '1';
  return values;
}
