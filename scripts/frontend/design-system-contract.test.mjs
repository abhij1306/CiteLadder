import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  accentFillClassFindings,
  accentHeadingFindings,
  displayFaceClassFindings,
  stylesheetContractFindings,
  tokenContractFindings,
  websiteTypeCeilingClassFindings,
} from '../../frontend/scripts/design-system-contract.mjs';

const tokenCss = '@theme { --text-caption: 12px; --text-title: 22px; --text-display-2xl: 44px; }';
const view = 'components/example/view.tsx';

test('Cal Sans is set at weight 400 and 18px or more', () => {
  assert.deepEqual(displayFaceClassFindings('const a = "font-display text-title";', view), []);
  assert.deepEqual(displayFaceClassFindings('const a = "font-display font-semibold";', view), [
    `${view}:1: Cal Sans (font-display) is weight 400 only`,
  ]);
  assert.deepEqual(displayFaceClassFindings('const a = "font-display text-body-sm";', view), [
    `${view}:1: Cal Sans (font-display) is never under 18px; use a display role`,
  ]);
  const css =
    '.a { font-family: var(--font-display); font-size: var(--text-caption); }\n.b { font-family: var(--font-display); font-weight: 600; }';
  assert.deepEqual(stylesheetContractFindings(css, 'apps/marketing/src/x.css', tokenCss), [
    'apps/marketing/src/x.css:1: Cal Sans (--font-display) is never under 18px',
    'apps/marketing/src/x.css:2: Cal Sans (--font-display) is weight 400 only',
  ]);
});

test('Flare is a mark, never a fill or a heading', () => {
  assert.deepEqual(accentFillClassFindings('const a = "bg-accent px-4";', view), [
    `${view}:1: accent is a mark, never a button, background or fill; use ink or accent-soft`,
  ]);
  // A 4px dot or a hairline rung is a mark; the soft tint and the text ink are not fills.
  assert.deepEqual(
    accentFillClassFindings(
      'const a = "size-1 bg-accent"; const b = "bg-accent-soft text-accent-ink";',
      view,
    ),
    [],
  );
  assert.deepEqual(accentHeadingFindings([{ tag: 'h2', classes: 'text-accent', line: 3 }], view), [
    `${view}:3: a heading is ink, never accent`,
  ]);
  const css =
    '.cta { background: var(--color-accent); }\n.dot { width: 4px; background: var(--color-accent); }\n.page-title { color: var(--color-accent); }';
  assert.deepEqual(stylesheetContractFindings(css, 'components/x.css', tokenCss), [
    'components/x.css:1: accent is a mark, never a background; a fill larger than 4px is ink or accent-soft',
    'components/x.css:3: a heading is ink, never accent',
  ]);
});

test('website type never exceeds the 48px H1', () => {
  const css = '.a { font-size: var(--text-display-2xl); } .b { font-size: 3.5rem; }';
  assert.deepEqual(stylesheetContractFindings(css, 'apps/marketing/src/x.css', tokenCss), [
    'apps/marketing/src/x.css:1: website type never exceeds the 48px H1 (3.5rem)',
  ]);
  // The product is not the website: its stylesheets are judged by other rules.
  assert.deepEqual(stylesheetContractFindings(css, 'components/x.css', tokenCss), []);
  assert.deepEqual(
    websiteTypeCeilingClassFindings(
      'const a = "text-[56px]"; const b = "text-[48px]";',
      'components/marketing/hero.tsx',
    ),
    ['components/marketing/hero.tsx:1: website type never exceeds the 48px H1'],
  );
});

test('globals.css must carry the system tokens exactly, and nothing else', () => {
  const contract = JSON.parse(
    readFileSync(
      new URL('../../frontend/scripts/design-system-tokens.json', import.meta.url),
      'utf8',
    ),
  );
  const css = readFileSync(
    new URL('../../frontend/apps/app/src/globals.css', import.meta.url),
    'utf8',
  );
  assert.deepEqual(tokenContractFindings(css, contract), []);
  const drifted = css
    .replace('--color-accent: #e8501a;', '--color-accent: #00a650;')
    .replace('@theme {', '@theme {\n  --color-mint: #e6f6ec;');
  assert.deepEqual(tokenContractFindings(drifted, contract), [
    '--color-accent is #00a650 in light; the system says #e8501a',
    '--color-mint is not a system colour; the system has no such token',
  ]);
});
