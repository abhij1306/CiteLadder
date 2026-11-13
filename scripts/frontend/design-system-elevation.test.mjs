import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  radiusRoleAdvisories,
  shadowRoleViolations,
} from '../../frontend/scripts/design-system-source-checks.mjs';

test('elevation policy admits only roles and diagnoses radius family drift separately', () => {
  const label = 'components/ui/example.tsx';
  for (const source of [
    '<div className="shadow-raised" />',
    '<div className="shadow-overlay" />',
    '<div className="shadow-[0_2px_4px_currentColor]" />',
    '<div className="shadow-card" />',
  ]) {
    assert.equal(shadowRoleViolations(source, label, true).length, 1);
  }
  assert.deepEqual(
    shadowRoleViolations(
      '<div className="shadow-none shadow-xs shadow-float shadow-pop shadow-press" />',
      label,
      true,
    ),
    [],
  );
  assert.equal(
    shadowRoleViolations(
      '.surface { box-shadow: 0 2px 4px currentColor; }',
      'apps/app/src/example.css',
      true,
    ).length,
    1,
  );
  assert.deepEqual(
    shadowRoleViolations(
      '.surface { box-shadow: var(--shadow-pop); }',
      'apps/app/src/example.css',
      true,
    ),
    [],
  );
  assert.deepEqual(radiusRoleAdvisories('<Button className="rounded-lg" />', label, true), [
    'components/ui/example.tsx:1: review Button radius; its family is rounded-md',
  ]);
  assert.deepEqual(radiusRoleAdvisories('<Button className="rounded-md" />', label, true), []);
  assert.deepEqual(radiusRoleAdvisories('<Card className="rounded-lg" />', label, true), []);
});
