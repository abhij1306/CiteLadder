/** Fresh SQL-baseline schema for bootstrap/seed tests. Never reset a supplied database. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { beforeAll, afterAll } from 'vitest';
import { createDatabase } from '../src/db/database.ts';
import { loadConfig } from '../src/config.ts';
import { applyMigrations, baselineClient } from '../src/cli/schema-baseline.ts';

export function disposableDatabase() {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const name = `citeladder_bootstrap_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.API_TEST_DATABASE_URL!);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  url.pathname = `/${name}`;
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP)$/iu.test(key),
      ),
    ),
    CITELADDER_DISABLE_DOTENV: '1',
    APP_ENV: 'development',
    DATABASE_URL: url.href,
    ENCRYPTION_KEY: 'fixture-independent-encryption-key-0123456789abcdef',
    REFERRAL_HASH_SALT: 'fixture-independent-referral-salt-0123456789abcdef',
    DB_SSL_MODE: 'disable',
    FRONTEND_URL: 'http://127.0.0.1:3000',
  };
  const db = createDatabase(loadConfig(env));
  const connection = new pg.Client({ connectionString: admin.href });
  const execute = promisify(execFile);
  let created = false;
  beforeAll(async () => {
    await connection.connect();
    await connection.query(`CREATE DATABASE "${name}"`);
    created = true;
    const schema = baselineClient(url.href, env);
    await schema.connect();
    try {
      await applyMigrations(schema);
    } finally {
      await schema.end();
    }
  }, 120000);
  afterAll(async () => {
    try {
      await db.destroy();
      // Let closing pool connections finish; FORCE can race their socket shutdown.
      if (created) await connection.query(`DROP DATABASE "${name}"`);
    } finally {
      await connection.end();
    }
  });
  return { db, env, root, execute };
}
