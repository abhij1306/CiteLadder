import assert from 'node:assert/strict';
import { test } from 'node:test';

import { svgColorFindings } from '../../frontend/scripts/design-system-asset-checks.mjs';

const logo = 'public/citeladder-logo.svg';
const palette = new Map([
  ['--color-ink', '#111111'],
  ['--color-accent', '#e8501a'],
  ['--color-surface', '#ffffff'],
]);

test('a brand asset may paint only the tokens it is allowed', () => {
  const source = '<svg><path fill="#111111"/>\n<rect fill="#E8501A" stroke="none"/></svg>';
  assert.deepEqual(svgColorFindings(source, logo, palette), []);
  const drifted = svgColorFindings('<svg>\n<rect fill="#ff6a33"/></svg>', logo, palette);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].line, 2);
  assert.match(drifted[0].message, /is not --color-accent/);
});

test('a brand asset may name only its allowed tokens through var()', () => {
  assert.deepEqual(
    svgColorFindings('<svg><path fill="var(--color-accent, #e8501a)"/></svg>', logo, palette),
    [],
  );
  const other = svgColorFindings(
    '<svg><rect fill="var(--color-surface, #ffffff)"/></svg>',
    logo,
    palette,
  );
  assert.equal(other.length, 1);
  assert.equal(
    other[0].message,
    'fill var(--color-surface, #ffffff) is not one of --color-ink, --color-accent',
  );
});

test('other assets may paint with a palette token and its light fallback', () => {
  const label = 'public/illustrations/example.svg';
  assert.deepEqual(
    svgColorFindings(
      '<svg><rect fill="var(--color-ink, #111111)"/><path style="stroke: var(--color-accent)"/></svg>',
      label,
      palette,
    ),
    [],
  );
  assert.equal(
    svgColorFindings('<svg><rect fill="var(--color-ink, #222222)"/></svg>', label, palette).length,
    1,
  );
  assert.equal(
    svgColorFindings('<svg><rect fill="var(--color-nope)"/></svg>', label, palette).length,
    1,
  );
});

test('other assets paint with currentColor or none', () => {
  const label = 'public/example.svg';
  assert.deepEqual(
    svgColorFindings(
      '<svg><path fill="currentColor" stroke="none" style="fill: url(#a)"/></svg>',
      label,
      palette,
    ),
    [],
  );
  assert.deepEqual(
    svgColorFindings(
      '<svg><stop stop-color="#fff"/><path style="stroke: #000"/></svg>',
      label,
      palette,
    ).map(({ rule }) => rule),
    ['svg-color', 'svg-color'],
  );
});
