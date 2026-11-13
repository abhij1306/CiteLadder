import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  failuresFor,
  measure,
  policyDiffFailures,
} from '../../frontend/scripts/check-complexity.mjs';

function namesOf(source) {
  const directory = mkdtempSync(join(tmpdir(), 'citeladder-complexity-'));
  try {
    const file = join(directory, 'module.ts');
    writeFileSync(file, source);
    return measure(file).functions.map((fn) => fn.name);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('function identities hold no position, so an edit above them keeps every exception key', () => {
  const body = [
    'export async function finalize(db) {',
    '  await db.transaction().execute(async (trx) => trx);',
    '  await db.transaction().execute(async (trx) => [1].map((n) => n));',
    '}',
    'const routes = [{ handle() {} }, { handle() {} }];',
  ].join('\n');
  const expected = [
    'finalize',
    'finalize::<anonymous>',
    'finalize::<anonymous>#2',
    'finalize::<anonymous>#2::<anonymous>',
    'handle',
    'handle#2',
  ];
  assert.deepEqual(namesOf(body), expected);
  assert.deepEqual(namesOf(`const a = 1;\n\nconst b = 2;\n${body}`), expected);
});

test('only a test directory below frontend/ raises a module to the test ceiling', () => {
  const directory = mkdtempSync(join(tmpdir(), 'citeladder-complexity-'));
  try {
    const file = join(directory, 'test', 'module.ts');
    mkdirSync(join(directory, 'test'));
    writeFileSync(file, 'export const a = 1;\n');
    assert.equal(measure(file).test, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const fixture = fileURLToPath(
    new URL('../../frontend/services/api/test/action-support.ts', import.meta.url),
  );
  assert.equal(measure(fixture).test, true);
});

const apiPolicy = (functions) => ({
  format_version: 1,
  roots: ['services/api/src', 'services/api/scripts', 'services/api/test'],
  defaults: { max_function_cc: 12, max_test_loc: 800 },
  exceptions: { functions, modules: {} },
});

test('the API complexity ratchet only tightens against its base', () => {
  // A base from before the production LOC rule was retired still compares.
  const base = apiPolicy({ 'services/api/src/a.ts::run': 20 });
  base.defaults.max_production_loc = 500;
  assert.deepEqual(
    policyDiffFailures(
      base,
      apiPolicy({ 'services/api/src/a.ts::run': 21, 'services/api/src/b.ts::go': 13 }),
      'api',
    ),
    [
      'function exception services/api/src/a.ts::run increased 20 -> 21',
      'new function exception is forbidden: services/api/src/b.ts::go',
    ],
  );
  assert.deepEqual(policyDiffFailures(base, apiPolicy({}), 'api'), []);
});

test('only tests have a LOC ceiling; production size is the token hook rule', () => {
  const long = (test) => ({ loc: 900, test, functions: [] });
  assert.deepEqual(
    failuresFor(
      { 'services/api/src/a.ts': long(false), 'services/api/test/a.test.ts': long(true) },
      apiPolicy({}),
    ),
    ['services/api/test/a.test.ts: LOC 900 exceeds ceiling 800'],
  );
});
