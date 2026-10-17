import assert from 'node:assert/strict';
import test from 'node:test';

import { cardHeaderLayoutViolations } from '../../frontend/scripts/design-system-source-checks.mjs';

const check = (source) =>
  cardHeaderLayoutViolations(source, 'components/feature/screen.tsx', true).length;

test('a card header that lays out its own row is the retired shape', () => {
  assert.equal(
    check(
      '<CardHeader className="flex-row items-center justify-between"><CardTitle /></CardHeader>',
    ),
    1,
  );
  assert.equal(check("<CardHeader className={cn('sm:flex-row', open && 'pb-0')} />"), 1);
});

test('actions, spacing tweaks and other elements pass', () => {
  assert.equal(check('<CardHeader actions={<Badge />} bordered><CardTitle /></CardHeader>'), 0);
  assert.equal(check('<CardHeader className="pb-0" />'), 0);
  assert.equal(check('<div className="flex-row justify-between" />'), 0);
});

test('a direct child that lays out the header row is the same retired shape', () => {
  assert.equal(
    check(
      '<CardHeader><div className="flex flex-wrap items-start justify-between"><CardTitle /><Button /></div></CardHeader>',
    ),
    1,
  );
  assert.equal(
    check('<CardHeader><div className="grid gap-1"><CardTitle /></div><Alert /></CardHeader>'),
    0,
  );
});
