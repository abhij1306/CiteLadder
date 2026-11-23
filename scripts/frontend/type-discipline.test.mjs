import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nonNullCount,
  nonNullRatchetFailures,
  typeDisciplineFindings,
} from '../../frontend/scripts/type-discipline-checks.mjs';

const rules = (source, label = 'lib/example.ts') =>
  typeDisciplineFindings(source, label).map(({ rule, line }) => `${rule}@${line}`);

test('flags a key list cast from Object.keys, not one derived from its owner', () => {
  assert.deepEqual(
    rules(
      'const a = Object.keys(LAYOUT) as Key[];\nconst b = DROPS.map((drop) => drop.key);\nconst c = Object.entries(MAP) as [K, V][];',
    ),
    ['keys-cast@1', 'keys-cast@3'],
  );
});

test('flags an asserted first or last element, but never a split part', () => {
  assert.deepEqual(
    rules(
      [
        'const first = rows[0]!;',
        'const last = rows.at(-1)!;',
        "const head = path.split('/')[0]!;",
        "const tail = path.split('/').at(-1)!;",
        'const named = row[key]!;',
        'const checked = rows[0] ?? fallback;',
      ].join('\n'),
    ),
    ['index-non-null@1', 'index-non-null@2'],
  );
});

test('flags a cast in a value-change handler outside the generic controls', () => {
  const source = '<Select value={scope} onValueChange={(next) => setScope(next as Scope)} />';
  assert.deepEqual(rules(source, 'components/settings/scope.tsx'), ['value-change-cast@1']);
  assert.deepEqual(rules(source, 'components/ui/select.tsx'), []);
  assert.deepEqual(rules(source, 'components/ui/filter-row.tsx'), ['value-change-cast@1']);
  assert.deepEqual(
    rules('<Select value={scope} onValueChange={setScope} />', 'components/settings/scope.tsx'),
    [],
  );
});

test('flags a switch on a discriminant unless its default proves exhaustiveness', () => {
  assert.deepEqual(
    rules(
      [
        "function f() { switch (event.kind) { case 'a': return 1; default: return 0; } }",
        "function f() { switch (status) { case 'a': return 1; } }",
        "function f() { switch (phase) { case 'a': return 1; default: { const unhandled: never = phase; return unhandled; } } }",
        "function f() { switch (row.type) { case 'a': break; default: assertNever(row); } }",
        "function f() { switch (name) { case 'a': return 1; default: return 0; } }",
        "function f() { switch (state) { case 'a': return 1; default: return state satisfies never; } }",
        "function f() { switch (kind) { case 'a': return 1; default: { const check = (x: Kind) => x satisfies never; return 0; } } }",
        "function f() { switch (mode) { case 'a': return 1; default: { const empty: never[] = []; return empty.length; } } }",
      ].join('\n'),
    ),
    ['exhaustive-switch@1', 'exhaustive-switch@2', 'exhaustive-switch@7', 'exhaustive-switch@8'],
  );
});

test('counts non-null assertions and fails only a file whose count rose past its baseline', () => {
  assert.equal(
    nonNullCount('const a = map.get(k)!;\nconst b = rows[0]!.id!;\nconst c = d ?? e;', 'x.ts'),
    3,
  );
  assert.deepEqual(
    nonNullRatchetFailures(
      { 'services/api/src/a.ts': 3, 'services/api/src/b.ts': 1, 'services/api/src/new.ts': 1 },
      { 'services/api/src/a.ts': 2, 'services/api/src/b.ts': 4 },
    ),
    [
      'services/api/src/a.ts: 3 non-null assertions, baseline 2; narrow the value instead of asserting it',
      'services/api/src/new.ts: 1 non-null assertions, baseline 0; narrow the value instead of asserting it',
    ],
  );
});
