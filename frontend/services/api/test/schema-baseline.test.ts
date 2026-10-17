/** The migrate CLI against real PostgreSQL: numbered migrations, each applied once. */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, readMigrations } from '../src/cli/schema-baseline.ts';

const base = new URL(process.env.API_TEST_DATABASE_URL!);
const admin = new pg.Client({
  connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).href,
});
const created: string[] = [];
const migrations = readMigrations();
const baseline = migrations[0]!;

async function freshDatabase() {
  const name = `citeladder_baseline_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  created.push(name);
  const url = Object.assign(new URL(base), { pathname: `/${name}` }).href;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return { client, url };
}

async function publicTables(client: pg.Client) {
  const result = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  return result.rows.map((row) => row.tablename);
}

const clients: pg.Client[] = [];
beforeAll(() => admin.connect());
afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()));
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

describe('a fresh database', () => {
  it('applies every migration once, applies later files on upgrade and refuses edited ones', async () => {
    const { client } = await freshDatabase();
    clients.push(client);

    expect(baseline.version).toBe('0001_baseline');
    expect(await applyMigrations(client)).toEqual(migrations.map((m) => m.version));
    expect(await publicTables(client)).toEqual(
      expect.arrayContaining(['schema_migrations', 'workspaces']),
    );
    expect(await applyMigrations(client)).toEqual([]);

    // A CRLF checkout is the same migration.
    const crlf = migrations.map((m) => ({ ...m, sql: m.sql.replaceAll('\n', '\r\n') }));
    expect(await applyMigrations(client, crlf)).toEqual([]);

    // An upgrade applies only the new file.
    const next = { version: '9998_add_extra', sql: 'CREATE TABLE public.extra (id integer);' };
    expect(await applyMigrations(client, [...migrations, next])).toEqual(['9998_add_extra']);
    expect(await publicTables(client)).toContain('extra');

    // An applied migration is frozen.
    const edited = [...migrations, { ...next, sql: `${next.sql}\nSELECT 1;` }];
    await expect(applyMigrations(client, edited)).rejects.toThrow(
      /Migration 9998_add_extra changed after this database applied it.*new numbered migration/u,
    );
    // A database migrated further than this release is refused, not altered.
    await expect(applyMigrations(client, migrations)).rejects.toThrow(
      /migrated with 9998_add_extra, which this version of CiteLadder does not have/u,
    );
    const ledger = await client.query<{ version: string }>(
      'select version from public.schema_migrations order by version',
    );
    expect(ledger.rows.map((row) => row.version)).toEqual([
      ...migrations.map((m) => m.version),
      '9998_add_extra',
    ]);
  }, 120000);

  it('rolls back every pending migration when one fails', async () => {
    const { client } = await freshDatabase();
    clients.push(client);
    const broken = {
      version: '9999_broken',
      sql: 'CREATE TABLE public.partial (id integer);\nSELECT 1 / 0;',
    };
    await expect(applyMigrations(client, [...migrations, broken])).rejects.toThrow(
      'division by zero',
    );
    expect(await publicTables(client)).toEqual([]);
  }, 120000);
});

describe('a database the migrations must not touch', () => {
  it('refuses unledgered tables', async () => {
    const { client } = await freshDatabase();
    clients.push(client);

    await client.query('CREATE TABLE public.users (id integer)');
    await expect(applyMigrations(client)).rejects.toThrow(
      /tables but no schema_migrations ledger.*empty database/u,
    );
    expect(await publicTables(client)).toEqual(['users']);
  }, 120000);

  it('fails the migrate job with the instruction', async () => {
    const { client, url } = await freshDatabase();
    // Any schema the ledger did not record, such as a database from before the ledger existed.
    await client.query('CREATE TABLE public.unrecorded_table (id integer PRIMARY KEY)');
    await client.end();
    const run = promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../src/cli/migrate.ts', import.meta.url))],
      {
        env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: url },
        timeout: 60000,
      },
    );
    await expect(run).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'no schema_migrations ledger, so migrations were not applied over them',
      ),
    });
  }, 90000);
});
