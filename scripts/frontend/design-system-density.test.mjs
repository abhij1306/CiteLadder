import assert from 'node:assert/strict';
import { test } from 'node:test';

import { densityRoleViolations } from '../../frontend/scripts/design-system-source-checks.mjs';

test('density policy rejects retired and fixed control metrics without confusing intrinsic glyphs', () => {
  const label = 'components/ui/example.tsx';
  for (const source of [
    '<button className="h-9" />',
    '<input className="h-11" />',
    '<input className="h-[var(--field-height)]" />',
    '<button className="h-[var(--control-height)]" />',
    '<button className="h-[36px]" />',
    '<button className="h-[28px]" />',
    '<button className="min-h-[48px]" />',
  ]) {
    assert.equal(densityRoleViolations(source, label, true).length, 1);
  }
  assert.deepEqual(
    densityRoleViolations(
      '<button className="h-(--control-md)"><svg className="size-4" /><i className="size-12" /></button>',
      label,
      true,
    ),
    [],
  );
});
