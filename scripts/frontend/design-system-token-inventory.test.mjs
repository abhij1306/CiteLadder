import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  duplicateTokenFindings,
  tokenInventory,
  zeroConsumerTokens,
} from '../../frontend/scripts/audit-design-tokens.mjs';

test('token inventory resolves scoped aliases and neutral state derivation in both themes', () => {
  const rows = tokenInventory(`
    @theme {
      --color-panel: #ffffff;
      --color-foreground: #000000;
      --color-active: color-mix(in srgb, var(--color-panel), var(--color-foreground) 10%);
      --color-secondary: var(--color-foreground);
    }
    :root[data-theme='dark'] { --color-panel: #000000; --color-foreground: #ffffff; }
  `);
  const active = rows.find(({ token }) => token === '--color-active');
  assert.equal(active.light, '#e6e6e6');
  assert.equal(active.dark, '#1a1a1a');
  const secondary = rows.find(({ token }) => token === '--color-secondary');
  assert.equal(secondary.light, '#000000');
  assert.equal(secondary.dark, '#ffffff');
});

test('two tokens with one value fail unless aliased or declared the same', () => {
  const source = (extra) => `@theme { --color-panel: #ffffff; --color-input: #ffffff; ${extra} }`;
  // Dark inherits the light values, so the pair collides in both themes.
  const duplicate = duplicateTokenFindings(source(''), []);
  assert.equal(duplicate.length, 2);
  assert.match(duplicate[0], /light --color-input and --color-panel/);
  assert.match(duplicate[1], /dark --color-input and --color-panel/);
  assert.deepEqual(
    duplicateTokenFindings(
      '@theme { --color-panel: #ffffff; --color-input: var(--color-panel); }',
      [],
    ),
    [],
  );
  const pair = { tokens: ['--color-panel', '--color-input'], reason: 'x' };
  const both = [
    { ...pair, theme: 'light' },
    { ...pair, theme: 'dark' },
  ];
  assert.deepEqual(duplicateTokenFindings(source(''), both), []);
  // A light allowance does not excuse the dark theme.
  const light = [{ ...pair, theme: 'light' }];
  assert.deepEqual(
    duplicateTokenFindings(source(''), light).map((finding) => finding.split(' ')[1]),
    ['dark'],
  );
});

test('a chart series may never wear a status or action value, allowlisted or not', () => {
  const source = '@theme { --color-chart-1: #0d9488; --color-success: #0d9488; }';
  const sameAs = ['light', 'dark'].map((theme) => ({
    theme,
    tokens: ['--color-chart-1', '--color-success'],
    reason: 'x',
  }));
  const findings = duplicateTokenFindings(source, sameAs);
  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.includes('chart series never wear')));
});

test('a token is consumed by var(), by a utility class or by its size companion', () => {
  const source = `@theme {
    --color-accent: #000000; --color-caret: #000000; --color-unused: #000000;
    --text-label: 0.8125rem; --text-label--line-height: 1.125rem;
    --radius-card: 12px; --ease-standard: linear; --font-sans: x;
  }`;
  const files = [
    { path: 'a.css', text: '.a { color: var(--color-accent); }' },
    {
      path: 'components/b.tsx',
      text: 'const b = cva("caret-caret/50 hover:text-label", {}); const c = <i className="rounded-card" />;',
    },
    { path: 'c.css', text: '.c { transition-timing-function: var(--ease-standard); }' },
    // A declaration is not a consumer.
    { path: 'd.css', text: ':root { --color-unused: #ffffff; }' },
  ];
  assert.deepEqual(zeroConsumerTokens(source, files), ['--color-unused']);
});
