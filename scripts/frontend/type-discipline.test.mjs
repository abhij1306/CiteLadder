import assert from 'node:assert/strict';
import test from 'node:test';

import { typeDisciplineFindings } from '../../frontend/scripts/type-discipline-checks.mjs';

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
