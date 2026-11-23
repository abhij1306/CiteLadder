import assert from 'node:assert/strict';
import test from 'node:test';

import { commentFindings, isCommentChecked } from '../../frontend/scripts/source-comments.mjs';

const lines = (source, file = 'lib/example.tsx') =>
  commentFindings(source, file).map(({ line }) => line);

test('keeps machine-read directives and rejects every other script comment', () => {
  const source = [
    '#!/usr/bin/env node',
    '/// <reference types="vite/client" />',
    '// oxlint-disable-next-line jsx-a11y/no-autofocus, jsx-a11y/prefer-tag-over-role',
    '// eslint-disable-next-line',
    '// react-doctor-disable-next-line react-doctor/no-giant-component',
    'const a = load(); // NOSONAR',
    '// @ts-expect-error',
    '/* @vite-ignore */ import(url);',
    '/* v8 ignore next */',
    'const b = /* #__PURE__ */ make();',
    '// prettier-ignore',
    '// explains the next line',
    '/** Documents a function. */',
    '// oxlint-disable-next-line jsx-a11y/no-autofocus -- the reason is free text',
    'const c = 1; // NOSONAR: trusted PATH.',
    "const d = '// a string, not a comment';",
    '// @ts-expect-error the type is wrong',
    '/** @public */',
    '/** @public imported by a fixture test */',
  ].join('\n');
  assert.deepEqual(lines(source), [12, 13, 14, 15, 17, 19]);
});

test('rejects a JSX comment but keeps a JSX directive', () => {
  const source = [
    'export const A = () => (',
    '  <div>',
    '    {/* a note */}',
    '    {/* oxlint-disable-next-line jsx-a11y/no-autofocus */}',
    '    <input autoFocus />',
    '  </div>',
    ');',
  ].join('\n');
  assert.deepEqual(lines(source), [3]);
});

test('rejects CSS comments outside strings', () => {
  const source = [
    '/* a note */',
    ".a::before { content: '/* not a comment */'; }",
    '.b { color: red; /* trailing */ }',
  ].join('\n');
  assert.deepEqual(lines(source, 'app.css'), [1, 3]);
});

test('reads Astro frontmatter, template, script and style comments', () => {
  const source = [
    '---',
    "import A from './a.astro'; // frontmatter",
    '---',
    '<!-- html -->',
    '<A label={/* expression */ "x"} />',
    '{items.map((item) => <li>{item}</li>)}',
    '<p>https://example.com, not a comment</p>',
    '<script>',
    '  // script',
    '</script>',
    '<style>',
    '  /* style */',
    '</style>',
  ].join('\n');
  assert.deepEqual(lines(source, 'components/a.astro'), [2, 4, 5, 9, 12]);
});

test('checks authored source and skips generated code, migrations and customer templates', () => {
  assert.deepEqual(
    [
      'frontend/lib/a.ts',
      'frontend/lib/a.test.ts',
      'scripts/quality.mjs',
      'frontend/apps/app/src/app.css',
      'frontend/components/a.astro',
      'frontend/services/api/src/db/generated/db.ts',
      'frontend/services/api/migrations/0001.ts',
      'frontend/apps/app/worker-configuration.d.ts',
      'frontend/apps/docs/public/templates/client.ts',
      'frontend/services/api/schema.sql',
      'docs/README.md',
    ].filter(isCommentChecked),
    [
      'frontend/lib/a.ts',
      'frontend/lib/a.test.ts',
      'scripts/quality.mjs',
      'frontend/apps/app/src/app.css',
      'frontend/components/a.astro',
    ],
  );
});
