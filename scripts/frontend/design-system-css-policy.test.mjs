import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cssPolicyFindings } from '../../frontend/scripts/design-system-css-checks.mjs';

const label = 'apps/app/src/example.css';
const rules = (css, file = label) => cssPolicyFindings(css, file).map(({ rule }) => rule);

test('radius must consume the ladder', () => {
  assert.deepEqual(rules('.a { border-radius: 6px; }'), ['css-radius']);
  assert.deepEqual(rules('.a { border-top-left-radius: 50%; }'), ['css-radius']);
  assert.deepEqual(rules('.a { border-radius: calc(var(--radius-lg) - 4px); }'), ['css-radius']);
  assert.deepEqual(
    rules(
      '.a { border-radius: var(--radius-card); } .b { border-radius: 0; } .c { border-radius: var(--radius-lg) var(--radius-lg) 0 0; }',
    ),
    [],
  );
});

test('type metrics must consume a text role outside the ladder owners', () => {
  assert.deepEqual(rules('.a { font-size: 14px; line-height: 1.3; }'), ['css-type', 'css-type']);
  assert.deepEqual(
    rules('.a { font-size: var(--text-sm); line-height: var(--text-sm--line-height); }'),
    [],
  );
  assert.deepEqual(rules('.a { line-height: 1; } .b { font-size: inherit; }'), []);
  const website = 'apps/app/src/website-type.css';
  assert.deepEqual(rules('.flow-title, .flow-help { font-size: 1.125rem; }', website), []);
  assert.deepEqual(rules(':where([data-flow-surface]) { font-size: 0.875rem; }', website), []);
  // A role owner elsewhere, or a descendant of one, is not the ladder.
  assert.deepEqual(rules('.flow-title { font-size: 1.125rem; }'), ['css-type']);
  assert.deepEqual(rules('.auth .flow-title { font-size: 1.75rem; }', website), ['css-type']);
});

test('spacing stays on the 4px grid, with hairline insets', () => {
  assert.deepEqual(rules('.a { padding: 6px 8px; }'), ['css-spacing']);
  assert.deepEqual(rules('.a { margin: -0.375rem; }'), ['css-spacing']);
  assert.deepEqual(rules('.a { gap: 10px; }'), ['css-spacing']);
  assert.deepEqual(
    rules(
      '.a { padding: 8px 1rem; margin: -2px auto; top: 1px; inset: 0; gap: calc(var(--x) + 3px); left: 50%; }',
    ),
    [],
  );
});

test('timing must consume motion and easing roles', () => {
  assert.deepEqual(rules('.a { transition: color 150ms ease-out; }'), ['css-motion']);
  assert.deepEqual(rules('.a { animation: spin 1s linear infinite; }'), ['css-motion']);
  assert.deepEqual(rules('.a { transition-timing-function: cubic-bezier(0, 0, 1, 1); }'), [
    'css-motion',
  ]);
  assert.deepEqual(
    rules(
      '.a { transition: color var(--motion-fast) var(--ease-standard); animation-delay: calc(var(--motion-fast) * 2); transition-duration: 0s; }',
    ),
    [],
  );
});

test('outlines belong to the shared focus rule', () => {
  assert.deepEqual(rules('.a:focus-visible { outline: 2px solid var(--color-accent); }'), [
    'css-outline',
  ]);
  assert.deepEqual(rules('.a { outline-offset: 2px; }'), ['css-outline']);
  assert.deepEqual(rules('.a { outline: none; } .b { outline: 0; }'), []);
});

test('box-shadow takes a shadow role or a token hairline', () => {
  assert.deepEqual(rules('.a { box-shadow: 0 4px 12px rgb(0 0 0 / 10%); }'), ['css-shadow']);
  assert.deepEqual(rules('.a { box-shadow: inset 0 -3px 0 var(--color-accent); }'), ['css-shadow']);
  assert.deepEqual(
    rules(
      '.t { box-shadow: inset 0 -2px 0 var(--color-accent); } .a { box-shadow: var(--elevation-card); } .b { box-shadow: none; } .c { box-shadow: 0 0 0 1px var(--color-border), var(--shadow-overlay); } .d { box-shadow: inset 0 1px 0 var(--color-border-subtle); }',
    ),
    [],
  );
});

test('the token owner and custom properties are not judged', () => {
  assert.deepEqual(rules('.a { border-radius: 6px; }', 'apps/app/src/globals.css'), []);
  assert.deepEqual(rules('.a { --gap: 6px; --radius: 6px; }'), []);
});

test('a custom property that reads itself is a cycle', () => {
  assert.deepEqual(rules('.a { --text-sm--line-height: var(--text-sm--line-height); }'), [
    'css-cycle',
  ]);
  assert.deepEqual(rules('.a { --gap: var(--card-padding); }'), []);
});
