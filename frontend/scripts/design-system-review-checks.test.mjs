import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reviewScriptFindings, reviewStylesheetFindings } from './design-system-review-checks.mjs';

const tsx = (className) => `export const X = () => <p className="${className}">x</p>;\n`;

test('D6: a heavier-than-500 weight fails on every surface, the website included', () => {
  assert.deepEqual(reviewScriptFindings(tsx('text-ink font-semibold'), 'components/ui/card.tsx'), [
    'components/ui/card.tsx:1: Geist is never set above 500 (decision D6); use a role or font-medium',
  ]);
  assert.equal(reviewScriptFindings(tsx('hover:font-bold'), 'apps/docs/src/x.tsx').length, 1);
  assert.deepEqual(reviewScriptFindings(tsx('text-ink font-medium'), 'components/ui/card.tsx'), []);
  assert.equal(
    reviewScriptFindings(tsx('font-semibold'), 'components/marketing/hero.tsx').length,
    1,
  );
  assert.deepEqual(
    reviewStylesheetFindings(
      '.a { font-weight: 600; }\n.b { font-weight: 500; }',
      'apps/docs/src/a.css',
    ),
    [
      'apps/docs/src/a.css:1: Geist is never set above 500 (decision D6); use a role or font-medium',
    ],
  );
  assert.equal(
    reviewStylesheetFindings(
      ':root { --text-heading--font-weight: 700; }',
      'apps/app/src/globals.css',
    ).length,
    1,
  );
  assert.deepEqual(
    reviewStylesheetFindings('.a { font-weight: 700; }', 'apps/marketing/src/site.css'),
    [
      'apps/marketing/src/site.css:1: Geist is never set above 500 (decision D6); use a role or font-medium',
    ],
  );
});

test('D5: line-control edges a field or card nowhere, and stays on small marks', () => {
  assert.deepEqual(
    reviewScriptFindings(tsx('bg-surface border-line-control border'), 'components/ui/input.tsx'),
    [
      'components/ui/input.tsx:1: line-control is for marks that are not borders; an edge is line or line-strong with shadow-edge (decision D5)',
    ],
  );
  assert.deepEqual(
    reviewScriptFindings(tsx('bg-surface border-line-control border'), 'components/ui/switch.tsx'),
    [],
  );
  assert.equal(
    reviewStylesheetFindings(
      '.card:hover { border-color: var(--color-line-control); }',
      'apps/docs/src/components/ArticlePager.astro',
    ).length,
    1,
  );
  // The token's own declaration is not a use of it.
  assert.deepEqual(
    reviewStylesheetFindings(':root { --color-line-control: gray; }', 'apps/app/src/globals.css'),
    [],
  );
});

test('D7: Cal Sans in the app is the page title alone; the docs keep their display face', () => {
  assert.deepEqual(
    reviewScriptFindings(tsx('font-display text-title text-ink'), 'components/ui/dialog.tsx'),
    [
      'components/ui/dialog.tsx:1: in the app Cal Sans is the page title alone (type-page-title, decision D7); use a Geist role',
    ],
  );
  assert.deepEqual(reviewScriptFindings(tsx('font-display text-title'), 'apps/docs/src/a.tsx'), []);
  // A font-face descriptor in a stylesheet string is not a class.
  assert.deepEqual(
    reviewScriptFindings(
      'export const css = "font-display: fallback;";\n',
      'lib/fonts/brand-fonts.ts',
    ),
    [],
  );
  const roles = [
    '.type-page-title { font-family: var(--font-display); }',
    '.type-figure { font-family: var(--font-display); }',
    '.prose-content h2 { font-family: var(--font-sans); }',
  ].join('\n');
  assert.deepEqual(reviewStylesheetFindings(roles, 'apps/app/src/globals.css'), [
    'apps/app/src/globals.css:2: in the app Cal Sans is the page title alone (type-page-title, decision D7); use a Geist role',
  ]);
});

test('D28: on the website Cal Sans sets the H1 and section headings, never a card title', () => {
  const message =
    'on the website Cal Sans is the H1 and one section heading (decision D28); set this in Geist';
  const css = [
    '.cl-shead-title { font-family: var(--font-display); }',
    '.cl-fcard-title { font-family: var(--font-display); }',
    '.cl-prose h2:not([class]) { font-family: var(--font-display); }',
    '.cl-prose :is(h2, h3):not([class]) { font-family: var(--font-display); }',
    '.cl-page-section:not(:has(.cl-shead-title, .cl-split ~ .cl-split)) .cl-split-title { font-family: var(--font-display); }',
    '.cl-split-title { font-family: var(--font-display); }',
    '.cl-faq-q { font-family: var(--font-sans); }',
  ].join('\n');
  assert.deepEqual(reviewStylesheetFindings(css, 'apps/marketing/src/site.css'), [
    `apps/marketing/src/site.css:2: ${message}`,
    `apps/marketing/src/site.css:4: ${message}`,
    `apps/marketing/src/site.css:6: ${message}`,
  ]);
  assert.deepEqual(
    reviewStylesheetFindings(
      '.cl-author-name { font-family: var(--font-display); }',
      'components/marketing/content/AuthorCard.astro',
    ),
    [`components/marketing/content/AuthorCard.astro:1: ${message}`],
  );
  assert.deepEqual(
    reviewScriptFindings(tsx('font-display text-ink'), 'components/marketing/sections/cards.tsx'),
    [`components/marketing/sections/cards.tsx:1: ${message}`],
  );
  // The docs' own styles keep their display face.
  assert.deepEqual(
    reviewStylesheetFindings(
      '.cl-ref-title { font-family: var(--font-display); }',
      'apps/docs/src/components/ReferenceBlock.astro',
    ),
    [],
  );
});

test('D9: a grid that adds columns between desktop and shell is a wrapped metric row', () => {
  const grid = (layout) => `const LAYOUT = { quarters: '${layout}' };\n`;
  assert.deepEqual(
    reviewScriptFindings(
      grid('desktop:grid-cols-2 shell:grid-cols-4'),
      'components/ui/app-grid.tsx',
    ),
    [
      "components/ui/app-grid.tsx:1: a row of equal items holds its count from 981px (decision D9), never 2 × 2 or 2 + 1 at the owner's 982px",
    ],
  );
  assert.deepEqual(
    reviewScriptFindings(grid('desktop:grid-cols-4'), 'components/ui/app-grid.tsx'),
    [],
  );
});

test('D10: radius-full stays on round things and no corner is rounder than 8px', () => {
  assert.deepEqual(reviewScriptFindings(tsx('bg-surface rounded-full'), 'components/ui/chip.tsx'), [
    'components/ui/chip.tsx:1: radius-full is for avatars, status dots, switch tracks and count pills only (decision D10)',
  ]);
  assert.deepEqual(
    reviewScriptFindings(tsx('size-8 rounded-full'), 'components/ui/avatar.tsx'),
    [],
  );
  const css = [
    '.chip { border-radius: var(--radius-full); }',
    '.cl-author-avatar { border-radius: var(--radius-full); }',
    '.tile { border-radius: 12px; }',
    '.pill { border-top-left-radius: 1rem; }',
    '.card { border-radius: var(--radius-lg) 0 0 8px; }',
  ].join('\n');
  assert.deepEqual(reviewStylesheetFindings(css, 'apps/marketing/src/site.css'), [
    'apps/marketing/src/site.css:1: radius-full is for avatars, status dots, switch tracks and count pills only (decision D10)',
    'apps/marketing/src/site.css:3: no corner is rounder than 8px (decision D10); use a radius token',
    'apps/marketing/src/site.css:4: no corner is rounder than 8px (decision D10); use a radius token',
  ]);
});

test('D11, D15: the app density block and stat size hold the owner values; no sidebar logo', () => {
  // Joined so this file holds no token block of its own (check:policy).
  const theme = ['@', 'theme'].join('');
  const compact = [
    `${theme} { --radius-lg: 8px; --text-stat: 28px; }`,
    '.type-page-title { font-size: var(--text-display-sm); }',
    ':root {',
    '  --page-section-gap: 16px; --workspace-gap: 12px;',
    '  --card-padding: 16px; --modal-padding: 16px; --table-row-height: var(--row-app);',
    '}',
  ].join('\n');
  assert.deepEqual(reviewStylesheetFindings(compact, 'apps/app/src/globals.css'), []);
  assert.deepEqual(
    reviewStylesheetFindings(
      compact
        .replace('--table-row-height: var(--row-app)', '--table-row-height: 44px')
        .replace('display-sm', 'display-md')
        .replace('--text-stat: 28px', '--text-stat: 36px'),
      'apps/app/src/globals.css',
    ),
    [
      'apps/app/src/globals.css: the app is compact (decision D11): :root must set --table-row-height: var(--row-app)',
      'apps/app/src/globals.css: the app is compact (decision D11): .type-page-title is var(--text-display-sm)',
      "apps/app/src/globals.css: a metric's number is 28px (decision D15): set --text-stat: 28px",
    ],
  );
  const sidebar = "import { LogoMark } from '@/components/ui/logo-mark';\n";
  assert.deepEqual(reviewScriptFindings(sidebar, 'components/layout/app-shell.tsx'), [
    'components/layout/app-shell.tsx: the app sidebar carries no logo (decision D11)',
  ]);
  assert.deepEqual(reviewScriptFindings(sidebar, 'components/ui/auth-shell.tsx'), []);
});
