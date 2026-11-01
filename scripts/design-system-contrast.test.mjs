import assert from 'node:assert/strict';
import test from 'node:test';

import {
  paletteDeclarations,
  paletteViolations,
} from '../frontend/scripts/design-system-contrast.mjs';

const STATUSES = ['success', 'warning', 'danger', 'info'];
const TAGS = [
  'blue',
  'purple',
  'green',
  'moss',
  'red',
  'orange',
  'amber',
  'teal',
  'yellow',
  'neutral',
];

/** A complete palette that passes every pair: ink on paper, paper on ink. */
function palette(ink, paper, marks, charts) {
  return {
    ...Object.fromEntries(
      ['panel', 'background', 'background-alt', 'well', 'sheet', 'panel-tonal'].map((role) => [
        `--color-${role}`,
        paper,
      ]),
    ),
    ...Object.fromEntries(
      ['foreground', 'secondary', 'muted', 'brand-ink', 'border-bold', 'state-ink'].map((role) => [
        `--color-${role}`,
        ink,
      ]),
    ),
    '--color-hover': 'color-mix(in srgb, var(--color-panel), var(--color-state-ink) 4%)',
    '--color-selected': 'color-mix(in srgb, var(--color-panel), var(--color-state-ink) 8%)',
    '--color-active': 'color-mix(in srgb, var(--color-panel), var(--color-state-ink) 12%)',
    ...Object.fromEntries(
      STATUSES.flatMap((status) => [
        [`--color-${status}-text`, ink],
        [`--color-${status}-bg`, paper],
      ]),
    ),
    ...Object.fromEntries(
      [...STATUSES, 'neutral'].map((status, index) => [`--color-${status}`, marks[index]]),
    ),
    ...Object.fromEntries(charts.map((value, index) => [`--color-chart-${index + 1}`, value])),
    ...Object.fromEntries(
      TAGS.flatMap((tag) => [
        [`--tag-${tag}-text`, ink],
        [`--tag-${tag}-bg`, paper],
      ]),
    ),
    '--color-accent-fill': ink,
    '--color-accent-fill-hover': ink,
    '--color-accent-fill-active': ink,
    '--color-accent-fg': paper,
    '--color-danger-solid': ink,
    '--color-danger-fg': paper,
    '--color-surface-inverse': ink,
    '--color-on-inverse': paper,
    '--color-selection': paper,
    '--color-selection-fg': ink,
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
