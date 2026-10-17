import { loadConfig, policy } from '../config.ts';
import { createDatabase, type Database, type DatabaseConfig } from '../db/database.ts';

export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

// Exact reviewed slugs only; never print arbitrary Error.message, Zod issues or DB diagnostics.
const safeFailures = new Set(['explicit_database_required', 'local_development_required']);

/** An operator refusal built only from reviewed text; its message is safe to print. */
export class OperatorRefusal extends Error {}

export function operatorDiagnostic(error: unknown): string {
  if (error instanceof OperatorRefusal) return error.message;
  if (error instanceof Error && safeFailures.has(error.message)) return error.message;
  if (error instanceof Error && error.message === 'An active admin user is required')
    return 'active_admin_required';
  // A PostgreSQL SQLSTATE (28P01: password rejected) names the cause without any input.
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[0-9A-Z]{5}$/u.test(error.code)
  )
    return `${error.constructor.name} ${error.code}`;
  return error instanceof Error ? error.constructor.name : 'Error';
}

/** Operator CLI errors expose a reviewed slug or type, never arbitrary input. */
export async function operatorMain(run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    console.error(operatorDiagnostic(error));
    process.exitCode = 1;
  }
}

/** Connection lifecycle only. Each command's domain owner enforces its own operator authority. */
export async function withOperatorDatabase(
  run: (db: Database) => Promise<void>,
  config: DatabaseConfig = loadConfig(),
) {
  const db = createDatabase(config);
  try {
    await run(db);
  } finally {
    await db.destroy();
  }
}

/** Refuse anything but a development environment on a loopback database. */
export function requireLocalDevelopment(config: { appEnv: string; databaseUrl: string }) {
  const target = new URL(config.databaseUrl);
  if (
    !policy.development_env_names.includes(config.appEnv.trim().toLowerCase()) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  )
    throw new Error('local_development_required');
}
