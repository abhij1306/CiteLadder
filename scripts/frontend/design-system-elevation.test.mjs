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
    '<div className="shadow-[0_2px_4px_currentColor]" />',
  ]) {
    assert.equal(shadowRoleViolations(source, label, true).length, 1);
  }
  assert.deepEqual(
    shadowRoleViolations(
      '<div className="shadow-none shadow-overlay shadow-modal" />',
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
      '.surface { box-shadow: var(--shadow-overlay); }',
      'apps/app/src/example.css',
      true,
    ),
    [],
  );
  assert.equal(
    radiusRoleAdvisories('<Button className="rounded-[var(--radius-card)]" />', label, true).length,
    1,
  );
  assert.deepEqual(
    radiusRoleAdvisories('<Button className="rounded-[var(--radius-control)]" />', label, true),
    [],
  );
});
