import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  duplicateTokenFindings,
  tokenInventory,
  zeroConsumerTokens,
} from '../../frontend/scripts/audit-design-tokens.mjs';

test('token inventory resolves scoped aliases in both themes', () => {
  const rows = tokenInventory(`
    @theme {
      --color-surface: #ffffff;
      --color-ink: #111111;
      --color-focus: var(--color-ink);
      --color-scrim: rgb(17 17 17 / 40%);
    }
    :root[data-theme='dark'] { --color-surface: #151515; --color-ink: #f4f4f4; }
  `);
  assert.deepEqual(rows, [
    { token: '--color-focus', light: '#111111', dark: '#f4f4f4' },
    { token: '--color-ink', light: '#111111', dark: '#f4f4f4' },
    { token: '--color-scrim', light: 'rgb(17 17 17 / 40%)', dark: 'rgb(17 17 17 / 40%)' },
    { token: '--color-surface', light: '#ffffff', dark: '#151515' },
  ]);
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

test('a chart series may never wear a status value, allowlisted or not', () => {
  const source = '@theme { --color-data-3: #0d9488; --color-positive: #0d9488; }';
  const sameAs = ['light', 'dark'].map((theme) => ({
    theme,
    tokens: ['--color-data-3', '--color-positive'],
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
  // A token the system's contract requires is not dead before a page uses it.
  assert.deepEqual(zeroConsumerTokens(source, files, new Set(['--color-unused'])), []);
});
