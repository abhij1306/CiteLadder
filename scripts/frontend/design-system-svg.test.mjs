import assert from 'node:assert/strict';
import { test } from 'node:test';

import { svgColorFindings } from '../../frontend/scripts/design-system-asset-checks.mjs';

const logo = 'public/citeladder-logo.svg';
const palette = new Map([
  ['--color-ink', '#111111'],
  ['--color-accent', '#e8501a'],
]);

test('a brand asset may paint only the tokens it is allowed', () => {
  const source = '<svg><path fill="#111111"/>\n<rect fill="#E8501A" stroke="none"/></svg>';
  assert.deepEqual(svgColorFindings(source, logo, palette), []);
  const drifted = svgColorFindings('<svg>\n<rect fill="#ff6a33"/></svg>', logo, palette);
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].line, 2);
  assert.match(drifted[0].message, /is not --color-accent/);
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
