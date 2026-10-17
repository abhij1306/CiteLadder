import assert from 'node:assert/strict';
import { test } from 'node:test';

import { focusRoleViolations } from '../../frontend/scripts/design-system-source-checks.mjs';

test('focus policy rejects local outlines and ring overrides while admitting the three owners', () => {
  const label = 'components/ui/example.tsx';
  for (const source of [
    '<button className="focus-visible:ring-2" />',
    '<button className="focus:outline-none" />',
    '<input className="outline-none" />',
  ]) {
    assert.equal(focusRoleViolations(source, label, true).length, 1);
  }
  assert.equal(
    focusRoleViolations(
      '.button:focus-visible { outline: 2px solid currentColor; }',
      'apps/app/src/overrides.css',
      true,
    ).length,
    1,
  );
  assert.deepEqual(focusRoleViolations("const phases = { outline: 'Outline' };", label, true), []);
  assert.deepEqual(
    focusRoleViolations(
      '<button className="focus-ring" /><input className="focus-input" /><div className="focus-frame" />',
      label,
      true,
    ),
    [],
  );
});

test('retired common focus tokens are rejected on separately owned public surfaces', () => {
  const label = 'apps/app/src/example.css';
  assert.equal(
    focusRoleViolations('.action { outline-color: var(--color-focus); }', label, false).length,
    1,
  );
  assert.deepEqual(
    focusRoleViolations('.action { color: var(--color-accent); }', label, false),
    [],
  );
});
