import { fileURLToPath } from 'node:url';

import { policy } from '../config.ts';
import { OperatorRefusal } from './operator.ts';

export type Execute = (
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined>; timeout: number; cwd: string },
) => Promise<unknown>;

const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DESTRUCTIVE_RESET_VARIABLE = 'RESET_CONFIRM_DESTRUCTIVE';
const DESTRUCTIVE_RESET_TOKEN = 'drop-and-recreate';

/**
 * The database a reset may drop. A development APP_ENV with a loopback host
 * authorizes it; anything else needs the explicit confirmation token.
 */
export function resetTarget(env: Record<string, string | undefined>) {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new OperatorRefusal('explicit_reset_database_required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OperatorRefusal('DATABASE_URL is not a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
    throw new OperatorRefusal('DATABASE_URL must name a PostgreSQL host.');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new OperatorRefusal('DATABASE_URL must name the database to reset.');
  if (PROTECTED_DATABASES.has(database.toLowerCase()))
    throw new OperatorRefusal(`Refusing to reset protected database '${database}'.`);
  const appEnv = env.APP_ENV?.trim().toLowerCase() ?? '';
  const host = url.hostname.toLowerCase();
  // An unset APP_ENV is development to the service, but never authorizes a DROP.
  const local =
    appEnv !== '' && policy.development_env_names.includes(appEnv) && LOCAL_HOSTS.has(host);
  if (!local && env[DESTRUCTIVE_RESET_VARIABLE]?.trim() !== DESTRUCTIVE_RESET_TOKEN)
    throw new OperatorRefusal(
      `Refusing to drop the database: APP_ENV is '${appEnv || '(unset)'}' and the target host is '${host}'. ` +
        `Automatic reset requires a development APP_ENV and a loopback host; otherwise set ` +
        `${DESTRUCTIVE_RESET_VARIABLE}=${DESTRUCTIVE_RESET_TOKEN} to confirm this exact database is safe to destroy.`,
    );
  const admin = new URL(url);
  admin.pathname = '/postgres';
  admin.search = '';
  return { database, adminUrl: admin.href, databaseUrl: url.href };
}

/** Authorize once before destruction; a failed reset never recreates the local workspace. */
export async function resetSequence(env: Record<string, string | undefined>, execute: Execute) {
  resetTarget(env);
  const timeout = Number(env.RESET_MIGRATION_TIMEOUT_SECONDS || 300) + 120;
  if (!Number.isFinite(timeout) || timeout <= 120) throw new Error('invalid_reset_timeout');
  const provisionTimeout = Number(env.RESET_PROVISION_TIMEOUT_SECONDS || 300);
  if (!Number.isFinite(provisionTimeout) || provisionTimeout <= 0)
    throw new Error('invalid_provision_timeout');
  const options = {
    env: { ...env, CITELADDER_DISABLE_DOTENV: '1' },
    timeout: timeout * 1000,
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
  };
  await execute(
    process.execPath,
    [fileURLToPath(new URL('./reset-schema.ts', import.meta.url))],
    options,
  );
  await execute(
    process.execPath,
    [fileURLToPath(new URL('./reset-provision.ts', import.meta.url))],
    { ...options, timeout: provisionTimeout * 1000 + 1000 },
  );
}
