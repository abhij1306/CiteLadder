import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contrastRoles,
  paletteDeclarations,
  paletteViolations,
} from '../frontend/scripts/design-system-contrast.mjs';

/**
 * A complete palette that passes every pair. Every ink the matrix reads is
 * `ink` and every surface `paper`, so a new matrix row needs no fixture edit;
 * the marks, chart series and state tints the other checks measure are set
 * explicitly.
 */
function palette(ink, paper, marks, charts) {
  const { inks, surfaces } = contrastRoles();
  return {
    ...Object.fromEntries(surfaces.map((token) => [token, paper])),
    ...Object.fromEntries(inks.map((token) => [token, ink])),
    '--color-state-ink': ink,
    '--color-hover': 'color-mix(in srgb, var(--color-panel), var(--color-state-ink) 4%)',
    '--color-selected': 'color-mix(in srgb, var(--color-panel), var(--color-state-ink) 8%)',
    '--color-active': 'color-mix(in srgb, var(--color-panel), var(--color-state-ink) 12%)',
    ...Object.fromEntries(
      ['success', 'warning', 'danger', 'info', 'neutral'].map((status, index) => [
        `--color-${status}`,
        marks[index],
      ]),
    ),
    ...Object.fromEntries(charts.map((value, index) => [`--color-chart-${index + 1}`, value])),
  };
}

const LIGHT = palette(
  '#000000',
  '#ffffff',
  ['#000000', '#303030', '#5e5e5e', '#919191', '#c6c6c6'],
  ['#000000', '#767676', '#000000', '#767676', '#000000', '#767676', '#000000', '#767676'],
);
const DARK = palette(
  '#ffffff',
  '#000000',
  ['#ffffff', '#c6c6c6', '#919191', '#5e5e5e', '#303030'],
  ['#ffffff', '#777777', '#ffffff', '#777777', '#ffffff', '#777777', '#ffffff', '#777777'],
);

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
    ':root { --color-panel: #ffffff; @media (min-width: 1px) { --color-nested: #000000; } --color-muted: #555555 }',
    ':root',
  );
  assert.equal(declarations.get('--color-panel'), '#ffffff');
  assert.equal(declarations.get('--color-muted'), '#555555');
  assert.equal(declarations.has('--color-nested'), false);
});

test('a palette that meets every pair in every scope passes', () => {
  assert.deepEqual(paletteViolations(css()), []);
});

test('a translucent status background is composited onto the panel before measuring', () => {
  const violations = paletteViolations(
    css({ light: { '--color-success-bg': 'rgb(0 0 0 / 90%)' } }),
  );
  assert.ok(
    violations.some((violation) =>
      violation.includes('--color-success-text on --color-success-bg'),
    ),
  );
});

test('light charts must hold 3:1 on the panel', () => {
  const violations = paletteViolations(css({ light: { '--color-chart-3': '#eeeeee' } }));
  assert.ok(violations.some((violation) => violation.includes('--color-chart-3 on --color-panel')));
});

test('outcome marks too close in lightness and under red-green loss fail', () => {
  const violations = paletteViolations(css({ dark: { '--color-warning': '#f4f4f4' } }));
  assert.ok(
    violations.some(
      (violation) =>
        violation.includes("data-theme='dark'") &&
        violation.includes('outcome marks --color-success / --color-warning'),
    ),
  );
  // A hue difference that survives both deficiencies separates marks of
  // equal lightness: blue against amber.
  const hued = paletteViolations(
    css({ light: { '--color-success': '#3b82f6', '--color-warning': '#b98a00' } }),
  );
  assert.ok(!hued.some((violation) => violation.includes('--color-success / --color-warning')));
});

test('state tints must step away from the panel in order', () => {
  const violations = paletteViolations(css({ light: { '--color-selected': '#ffffff' } }));
  assert.ok(violations.some((violation) => violation.includes('--color-selected must be darker')));
});
