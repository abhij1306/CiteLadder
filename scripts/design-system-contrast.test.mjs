import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  contrastRoles,
  paletteDeclarations,
  paletteViolations,
  resolvePalette,
} from '../frontend/scripts/design-system-contrast.mjs';

function palette({ ink, paper }) {
  const { inks, surfaces } = contrastRoles();
  return {
    ...Object.fromEntries(surfaces.map((token) => [token, paper])),
    ...Object.fromEntries(inks.map((token) => [token, ink])),
    '--color-ink-hover': ink,
    '--color-on-ink': paper,
  };
}

const LIGHT = palette({ ink: '#000000', paper: '#ffffff' });
const DARK = palette({ ink: '#ffffff', paper: '#000000' });

const block = (selector, values) =>
  `${selector} { ${Object.entries(values)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')} }`;

function css({ light = {}, dark = {}, extra = '' } = {}) {
  return [
    block('@theme', { ...LIGHT, ...light }),
    block(":root[data-theme='dark']", { ...DARK, ...dark }),
    extra,
  ].join('\n');
}

test('a scope keeps an unterminated last declaration and skips nested blocks', () => {
  const declarations = paletteDeclarations(
    ':root { --color-paper: #ffffff; @media (min-width: 1px) { --color-nested: #000000; } --color-ink-muted: #555555 }',
    ':root',
  );
  assert.equal(declarations.get('--color-paper'), '#ffffff');
  assert.equal(declarations.get('--color-ink-muted'), '#555555');
  assert.equal(declarations.has('--color-nested'), false);
});

test('a palette that meets every pair in every scope passes', () => {
  assert.deepEqual(paletteViolations(css()), []);
});

test('a dark rebinding fails the dark scope only', () => {
  const violations = paletteViolations(css({ dark: { '--color-ink-muted': '#111111' } }));
  assert.ok(violations.length > 0);
  assert.ok(violations.every((violation) => violation.includes("data-theme='dark'")));
  assert.ok(
    violations.some((violation) => violation.includes('--color-ink-muted on --color-paper')),
  );
});

test('an app rebinding fails the theme it reaches', () => {
  const appLight = ':root:not([data-public-surface]) { --color-ink-secondary: #eeeeee; }';
  const violations = paletteViolations(css({ extra: appLight }));
  assert.ok(
    violations.some((violation) =>
      violation.includes(': :root --color-ink-secondary on --color-chrome is 1.'),
    ),
  );
});

test("the app's light rebinding reaches the app's dark unless the app's dark rebinds it", () => {
  const appLight = ':root:not([data-public-surface]) { --color-ink-secondary: #555555; }';
  const appDark =
    ":root[data-theme='dark']:not([data-public-surface]) { --color-ink-secondary: #ffffff; }";
  const unbound = paletteViolations(css({ extra: appLight }));
  assert.ok(
    unbound.some((violation) =>
      violation.includes(":root[data-theme='dark'] --color-ink-secondary on --color-paper is 2."),
    ),
  );
  assert.deepEqual(paletteViolations(css({ extra: `${appLight}\n${appDark}` })), []);
});

test('a translucent soft is composited onto the surface before measuring', () => {
  const violations = paletteViolations(
    css({ light: { '--color-positive-soft': 'rgb(0 0 0 / 90%)' } }),
  );
  assert.ok(
    violations.some((violation) =>
      violation.includes('--color-positive on --color-positive-soft is 1.'),
    ),
  );
});

test('oklch literals and relative colours resolve to the sRGB they render', () => {
  const source = [
    '@theme { --color-ink: oklch(17.8% 0 0); --color-hover: oklch(from var(--color-ink) l c h / 6%); }',
    '@theme inline { --color-mark: var(--color-accent); }',
    ':root { --color-accent: oklch(63.4% 0.1973 37.5); --color-rule: oklch(21% 0.01 268 / 11%); }',
    ":root[data-theme='dark'] { --color-ink: oklch(96.7% 0 0); }",
  ].join('\n');
  const light = resolvePalette(source, ':root');
  assert.deepEqual(
    ['--color-ink', '--color-hover', '--color-mark', '--color-rule'].map((token) =>
      light.get(token),
    ),
    ['#111111', 'rgb(17 17 17 / 6%)', '#e8501a', 'rgb(22 24 29 / 11%)'],
  );
  assert.equal(
    resolvePalette(source, ":root[data-theme='dark']").get('--color-hover'),
    'rgb(244 244 244 / 6%)',
  );
});

test('the shipped palette meets every pair in both themes', () => {
  const source = readFileSync(
    new URL('../frontend/apps/app/src/globals.css', import.meta.url),
    'utf8',
  );
  assert.deepEqual(paletteViolations(source), []);
});

test('a stylesheet without a dark mapping fails', () => {
  const violations = paletteViolations(block('@theme', LIGHT));
  assert.ok(violations.includes('apps/app/src/globals.css: dark theme token mapping is missing'));
});
