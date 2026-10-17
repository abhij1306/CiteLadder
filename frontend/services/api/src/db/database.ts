/**
 * PostgreSQL pool and Kysely instance.
 *
 * Pool size, recycle age, acquisition and command timeouts, and the
 * server-side statement, lock and idle-in-transaction timeouts. The SQL
 * migrations (`migrations/`) are the only schema author; this module holds
 * generated types, never DDL.
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { ServiceConfig } from '../config.ts';
import type { DB } from '../generated/db-schema.ts';
import { getLogger } from '../logging.ts';

export type Database = Kysely<DB>;

/**
 * Run `work` in the caller's transaction when `db` is one, else in a new
 * transaction, so a confirmed MCP change commits with its confirmation.
 */
export function inTransaction<T>(db: Database, work: (trx: Database) => Promise<T>): Promise<T> {
  return db.isTransaction ? work(db) : db.transaction().execute(work);
}
export type DatabaseConfig = Pick<ServiceConfig, 'database' | 'databaseUrl' | 'appName'> & {
  execution?: Pick<ServiceConfig['execution'], 'poolSize'>;
};

export function poolOptions(config: DatabaseConfig): pg.PoolConfig {
  const db = config.database;
  return {
    connectionString: config.databaseUrl,
    // pool_size + max_overflow concurrent connections.
    max: db.poolSize + db.maxOverflow,
    maxLifetimeSeconds: db.poolRecycleSeconds,
    // node-postgres applies one bound to both waiting for a pooled client and
    // opening a new one, so the larger of the pool and connect timeouts applies.
    connectionTimeoutMillis: Math.max(db.poolTimeoutSeconds, db.connectTimeoutSeconds) * 1000,
    query_timeout: db.commandTimeoutSeconds * 1000,
    statement_timeout: db.statementTimeoutMs,
    lock_timeout: db.lockTimeoutMs,
    // Detect a dead peer (database VM restart) instead of waiting on a silent socket.
    keepAlive: true,
    idle_in_transaction_session_timeout: db.idleTransactionTimeoutMs,
    application_name: config.appName,
    // `require` encrypts without verifying the certificate (libpq sslmode=require).
    ssl: db.sslMode === 'require' ? { rejectUnauthorized: false } : false,
  };
}

export function createDatabase(
  config: DatabaseConfig,
  options: { execution?: boolean } = {},
): Database {
  const pool = new pg.Pool({
    ...poolOptions(config),
    ...(options.execution ? { max: config.execution?.poolSize } : {}),
  });
  // An idle client that loses its connection (a database restart) is dropped
  // by the pool; without a listener its 'error' event would crash the process.
  pool.on('error', (error) => getLogger('db').exception('database_idle_client_lost', error));
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
