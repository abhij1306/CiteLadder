import assert from 'node:assert/strict';
import { test } from 'node:test';

import { motionRoleViolations } from '../../frontend/scripts/design-system-source-checks.mjs';

test('motion policy rejects local timing recipes but permits measurements and role consumers', () => {
  const label = 'components/ui/example.tsx';
  for (const source of [
    '<button className="transition-colors duration-150" />',
    '<button className="duration-[120ms] ease-out" />',
    "const style = { transition: 'transform 0.2s ease-out' };",
    "const transition = 'transform 120ms var(--ease-standard)';",
    "const style = { transition: 'opacity 120ms var(--ease-standard)' };",
    '.menu { animation: enter 150ms cubic-bezier(0, 0, 1, 1); }',
  ]) {
    assert.equal(motionRoleViolations(source, label, true).length, 1);
  }
  for (const source of [
    '<span>Response time: 840ms</span>',
    '// The menu used to fade over 150ms.',
    '<button className="duration-[var(--motion-fast)] ease-[var(--ease-standard)]" />',
    '.menu { animation: enter var(--motion-normal) var(--ease-enter); }',
  ]) {
    assert.deepEqual(motionRoleViolations(source, label, true), []);
  }
  assert.deepEqual(motionRoleViolations('.menu { transition: color 150ms; }', label, false), []);
  assert.deepEqual(
    motionRoleViolations('--motion-fast: 110ms;', 'apps/app/src/globals.css', true),
    [],
  );
});
