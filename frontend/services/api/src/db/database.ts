/**
 * PostgreSQL pool and Kysely instance.
 *
 * Pool size, recycle age, acquisition and command timeouts, and the
 * server-side statement, lock and idle-in-transaction timeouts. The SQL
 * migrations (`migrations/`) are the only schema author; this module holds
 * generated types, never DDL.
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

import type { ServiceConfig } from '../config.ts';
import type { DB } from '../generated/db-schema.ts';
import { getLogger } from '../logging.ts';

export type Database = Kysely<DB>;

/** Run `work` in the caller's transaction when `db` is one, else in a new transaction. */
export function inTransaction<T>(db: Database, work: (trx: Database) => Promise<T>): Promise<T> {
  return db.isTransaction ? work(db) : db.transaction().execute(work);
}

/**
 * Logs the current database's on-disk size, so a log-based alert can watch
 * disk usage. Returns the size in bytes.
 */
export async function observeDatabaseSize(db: Database): Promise<number> {
  const { rows } = await sql<{
    size_bytes: string;
  }>`select pg_database_size(current_database())::text as size_bytes`.execute(db);
  const sizeBytes = Number(rows[0]?.size_bytes);
  getLogger('db').info('database_size_observed', { size_bytes: sizeBytes });
  return sizeBytes;
}

export type DatabaseConfig = Pick<ServiceConfig, 'database' | 'databaseUrl' | 'appName'> & {
  execution?: Pick<ServiceConfig['execution'], 'poolSize'>;
};

type PoolUse = { execution?: boolean };

export function poolOptions(config: DatabaseConfig, use: PoolUse = {}): pg.PoolConfig {
  const db = config.database;
  return {
    connectionString: config.databaseUrl,
    max:
      use.execution && config.execution ? config.execution.poolSize : db.poolSize + db.maxOverflow,
    maxLifetimeSeconds: db.poolRecycleSeconds,
    connectionTimeoutMillis: Math.max(db.poolTimeoutSeconds, db.connectTimeoutSeconds) * 1000,
    query_timeout: db.commandTimeoutSeconds * 1000,
    statement_timeout: db.statementTimeoutMs,
    lock_timeout: db.lockTimeoutMs,
    keepAlive: true,
    idle_in_transaction_session_timeout: db.idleTransactionTimeoutMs,
    application_name: config.appName,
    ssl: db.sslMode === 'require' ? { rejectUnauthorized: false } : false,
  };
}

export function createDatabase(config: DatabaseConfig, use: PoolUse = {}): Database {
  const pool = new pg.Pool(poolOptions(config, use));
  pool.on('error', (error) => getLogger('db').exception('database_idle_client_lost', error));
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
