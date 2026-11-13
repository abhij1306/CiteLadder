/**
 * Schema migrations: the numbered SQL files in `migrations/`
 * (`0001_baseline.sql`, then `0002_*.sql`, ...), each applied once and
 * recorded with its SHA-256 in `schema_migrations`. A run applies every
 * pending file, in order, in one transaction under an advisory lock and
 * bounded lock and statement timeouts.
 *
 * An applied file is frozen: a schema change is a new numbered file, never an
 * edit, and a database whose recorded checksums differ from the files is
 * refused rather than adapted in place, with the reset instruction. Before 1.0
 * a release may rewrite the baseline itself, so a database migrated by an
 * earlier release is refused the same way.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import pg from 'pg';

import { databaseSettings, migrationTimeouts } from '../config.ts';
import { poolOptions } from '../db/database.ts';
import { OperatorRefusal } from './operator.ts';

export type Migration = { version: string; sql: string };

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.sql$/u;
const LOCK_KEY = createHash('sha256')
  .update('citeladder:schema-baseline')
  .digest()
  .readBigInt64BE(0);
const RESET =
  'To start over, point DATABASE_URL at a new, empty database (the old one keeps its data).';

/** The migration files, in version order. */
export function readMigrations(dir: URL = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .map((name) => MIGRATION_FILE.exec(name)?.[1])
    .filter((version): version is string => version !== undefined)
    .sort()
    .map((version) => ({ version, sql: readFileSync(new URL(`${version}.sql`, dir), 'utf8') }));
}

/** Line endings are not schema: a CRLF checkout records the same checksum. */
function checksumOf(sqlText: string): string {
  return createHash('sha256').update(sqlText.replaceAll('\r\n', '\n')).digest('hex');
}

async function exists(client: pg.ClientBase, relation: string): Promise<boolean> {
  const result = await client.query('select 1 where to_regclass($1) is not null', [relation]);
  return result.rows.length > 0;
}

/** The migrations still to apply, after proving the recorded ones match their files. */
async function pending(client: pg.ClientBase, migrations: readonly Migration[]) {
  if (!(await exists(client, 'public.schema_migrations'))) {
    const relations = await client.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') limit 1`,
    );
    if (relations.rows.length > 0)
      throw new OperatorRefusal(
        `The database has tables but no schema_migrations ledger, so migrations were not applied over them. Point DATABASE_URL at an empty database. ${RESET}`,
      );
    return [...migrations];
  }
  const ledger = await client.query<{ version: string; checksum: string }>(
    'select version, checksum from public.schema_migrations',
  );
  const files = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const { version, checksum } of ledger.rows) {
    const file = files.get(version);
    if (!file)
      throw new OperatorRefusal(
        `The database was migrated with ${version}, which this version of CiteLadder does not have. Run a CiteLadder release that includes it.`,
      );
    if (checksumOf(file.sql) !== checksum)
      throw new OperatorRefusal(
        `Migration ${version} changed after this database applied it (recorded ${checksum.slice(0, 12)}, file ${checksumOf(file.sql).slice(0, 12)}). Applied migrations are frozen: restore the file and put the change in a new numbered migration. ${RESET}`,
      );
  }
  const applied = new Set(ledger.rows.map((row) => row.version));
  return migrations.filter((migration) => !applied.has(migration.version));
}

/**
 * A schema client with the configured TLS and the migration bounds as its
 * session timeouts: a statement that waits on a lock held by the running app
 * fails after the lock bound instead of queueing the app's queries behind it,
 * and a statement that runs past the statement bound fails the run. Either
 * rolls the whole apply back. The client-side query bound is off because the
 * server enforces both.
 */
export function baselineClient(
  databaseUrl: string,
  env: Record<string, string | undefined> = process.env,
) {
  const timeouts = migrationTimeouts(env);
  return new pg.Client({
    ...poolOptions({ appName: 'CiteLadder migrate', databaseUrl, database: databaseSettings(env) }),
    query_timeout: undefined,
    statement_timeout: timeouts.statementTimeoutMs,
    lock_timeout: timeouts.lockTimeoutMs,
  });
}

/**
 * Apply every pending migration in one transaction and return the applied
 * versions; a rerun on a current database applies nothing.
 */
export async function applyMigrations(
  client: pg.ClientBase,
  migrations: readonly Migration[] = readMigrations(),
): Promise<string[]> {
  await client.query('begin');
  try {
    // A concurrent run waits on the advisory lock instead of failing; the
    // migrations themselves then run under the session's migration bounds.
    await client.query('set local statement_timeout = 0; set local lock_timeout = 0');
    await client.query('select pg_advisory_xact_lock($1::bigint)', [LOCK_KEY.toString()]);
    const bounds = 'reset statement_timeout; reset lock_timeout';
    await client.query(bounds);
    const todo = await pending(client, migrations);
    for (const migration of todo) {
      // A file that needs longer raises its own bound with `SET LOCAL`; the
      // next file starts under the configured bounds again.
      await client.query(`${migration.sql}\n;${bounds}`);
      await client.query(
        'insert into public.schema_migrations (version, checksum) values ($1, $2)',
        [migration.version, checksumOf(migration.sql)],
      );
    }
    await client.query('commit');
    return todo.map((migration) => migration.version);
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

/** A one-line summary of a migrate run for the CLIs. */
export function describeMigrations(applied: readonly string[]): string {
  return applied.length ? `Applied migrations: ${applied.join(', ')}.` : 'Schema is current.';
}
