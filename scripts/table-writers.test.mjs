import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  allowlistDiffFailures,
  apiModules,
  collectWriters,
  moduleWrites,
  schemaTables,
  validateAllowlist,
  writerFailures,
} from './table-writers.mjs';

const apiRoot = fileURLToPath(new URL('../frontend/services/api/', import.meta.url));
const known = new Set(['projects', 'site_issues', 'audit_runs']);

function repositoryGate(extraModules = {}) {
  const tables = schemaTables(readFileSync(`${apiRoot}src/generated/db-schema.ts`, 'utf8'));
  const modules = apiModules(apiRoot);
  for (const [path, source] of Object.entries(extraModules)) modules.set(path, source);
  const allowlist = validateAllowlist(
    JSON.parse(readFileSync(`${apiRoot}table-writers.json`, 'utf8')),
  );
  return writerFailures(collectWriters(modules, tables), allowlist);
}

test('the recorded allowlist matches every writer in the API service today', () => {
  assert.deepEqual(repositoryGate(), []);
});

test('a second module writing an owned table fails the gate', () => {
  assert.deepEqual(
    repositoryGate({
      'src/rogue-writer.ts': "await db.updateTable('projects').set({ name: 'Rogue' }).execute();",
    }),
    ['unlisted writer: projects <- src/rogue-writer.ts'],
  );
});

test('Kysely writes, raw SQL writes and dynamic tables are read; reads and comments are not', () => {
  const source = `
    // await db.insertInto('audit_runs') in a comment
    /* delete from projects */
    await db.selectFrom('site_issues').selectAll().execute();
    await trx.insertInto('projects as p').values(row).execute();
    await sql\`update site_issues i set is_current = \${current} where i.id = \${id}\`.execute(db);
    await sql\`insert into x values (1) on conflict do update set y = 1\`.execute(db);
    await db.deleteFrom(table).execute();
  `;
  assert.deepEqual(moduleWrites(source, known), {
    tables: ['projects', 'site_issues'],
    dynamic: true,
  });
});

test('a table computed in raw SQL or a Kysely template literal is a dynamic write', () => {
  const insert = 'await sql`insert into ${sql.table(name)} (id) values (${id})`.execute(db);';
  const update = 'await db.updateTable(`${prefix}_runs`).set(row).execute();';
  const read = 'await sql`select 1 from ${sql.table(name)}`.execute(db);';
  assert.deepEqual(
    [insert, update, read].map((source) => moduleWrites(source, known)),
    [
      { tables: [], dynamic: true },
      { tables: [], dynamic: true },
      { tables: [], dynamic: false },
    ],
  );
});

test('a regular expression with a quote does not hide the writes after it', () => {
  const source = `const quote = /'/u;\nawait db.deleteFrom('audit_runs').execute();`;
  assert.deepEqual(moduleWrites(source, known), { tables: ['audit_runs'], dynamic: false });
});

test('a writer that stops writing is stale, so the allowlist tightens', () => {
  const observed = { format_version: 1, tables: {}, dynamic_writers: [] };
  const allowlist = { format_version: 1, tables: { projects: ['src/a.ts'] }, dynamic_writers: [] };
  assert.deepEqual(writerFailures(observed, allowlist), ['stale writer: projects <- src/a.ts']);
});

test('against its base the allowlist refuses new writers but admits a new single-writer table', () => {
  const base = {
    format_version: 1,
    tables: { projects: ['src/projects/service.ts'] },
    dynamic_writers: ['src/queue/task-queue.ts'],
  };
  const grown = {
    format_version: 1,
    tables: {
      projects: ['src/projects/service.ts', 'src/projects/import.ts'],
      audit_runs: ['src/audits/runs.ts'],
      site_issues: ['src/site-health/a.ts', 'src/site-health/b.ts'],
    },
    dynamic_writers: ['src/queue/task-queue.ts', 'src/queue/other.ts'],
  };
  assert.deepEqual(allowlistDiffFailures(base, grown), [
    "'projects' has 2 writers; it may have at most 1",
    "'site_issues' has 2 writers; it may have at most 1",
    'dynamic-table writers grew 1 -> 2',
  ]);
  const moved = { ...base, tables: { projects: ['src/projects/store.ts'] } };
  assert.deepEqual(allowlistDiffFailures(base, moved), []);
});
