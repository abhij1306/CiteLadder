import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compatViolations,
  cssCompatViolations,
  stylesheetFailures,
  supportMatrix,
} from '../../frontend/scripts/check-browser-compat.mjs';

const RAISED = supportMatrix([
  'chrome >= 123',
  'edge >= 123',
  'firefox >= 132',
  'safari >= 17.5',
  'ios_saf >= 17.5',
  'samsung >= 27',
]);
const PREVIOUS = supportMatrix([
  'chrome >= 120',
  'edge >= 120',
  'firefox >= 128',
  'safari >= 17.4',
  'ios_saf >= 17.4',
  'samsung >= 25',
]);

const apis = (source, matrix) =>
  compatViolations(source, 'lib/example.ts', matrix).map(({ api, line }) => `${api}@${line}`);

test('reads the oldest version of each matrix browser', () => {
  assert.deepEqual(RAISED, {
    chrome: '123',
    edge: '123',
    firefox: '132',
    safari: '17.5',
    safari_ios: '17.5',
    samsunginternet_android: '27',
  });
});

test('passes the APIs the raised matrix admits and fails them on the previous one', () => {
  const source =
    'const rows = await Array.fromAsync(chunks);\nconst valid = URL.canParse(value);\nconst copy = structuredClone(value);';
  assert.deepEqual(apis(source, RAISED), []);
  assert.deepEqual(apis(source, PREVIOUS), ['Array.fromAsync@1']);
});

test('fails a deliberately newer static, global instance and global API, not an older one', () => {
  const source = [
    'const result = Promise.try(work);',
    'document.startViewTransition(update);',
    'window.requestIdleCallback(work);',
    'navigator.clipboard.writeText(text);',
  ].join('\n');
  const violations = compatViolations(source, 'lib/example.ts', RAISED);
  assert.deepEqual(
    violations.map(({ api, line }) => `${api}@${line}`),
    ['Promise.try@1', 'document.startViewTransition@2', 'requestIdleCallback@3'],
  );
  assert.deepEqual(violations[0].missing, [
    'chrome 128',
    'edge 128',
    'firefox 134',
    'safari_ios 18.2',
    'safari 18.2',
    'samsunginternet_android 28.0',
  ]);
});

test('ignores a local binding that shares a browser global name', () => {
  assert.deepEqual(apis('import { Promise } from "./local";\nPromise.try(work);', RAISED), []);
  assert.deepEqual(apis('function run(document) { document.startViewTransition(); }', RAISED), []);
});

test('passes an API read only through optional chaining, not a direct read', () => {
  const source = [
    'window.trustedTypes?.createPolicy("default", rules);',
    'document.startViewTransition?.(update);',
    'window.trustedTypes.createPolicy("default", rules);',
  ].join('\n');
  assert.deepEqual(apis(source, RAISED), ['trustedTypes@3']);
});

const NEXT = supportMatrix([
  'chrome >= 123',
  'edge >= 123',
  'firefox >= 132',
  'safari >= 17.5',
  'ios_saf >= 17.5',
  'samsung >= 25',
]);

const css = (source, matrix) =>
  cssCompatViolations(source, 'lib/example.css', matrix).map(
    ({ feature, line }) => `${feature}@${line}`,
  );

test('fails a CSS feature below the matrix and passes it once the matrix reaches it', () => {
  const source = '@starting-style {\n  .menu { opacity: 0; }\n}';
  assert.deepEqual(css(source, PREVIOUS), ['@starting-style@1']);
  assert.deepEqual(cssCompatViolations(source, 'lib/example.css', PREVIOUS)[0].missing, [
    'firefox 129',
    'safari_ios 17.5',
    'safari 17.5',
  ]);
  assert.deepEqual(css(source, RAISED), []);
});

test('reads properties, keyword values, functions and pseudo-elements, and passes guarded uses', () => {
  const source = [
    'p { text-wrap: pretty; }',
    'p { text-wrap: wrap; text-wrap: pretty; }',
    '@supports (text-wrap: pretty) { p { text-wrap: pretty; } }',
    '.nav { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }',
    '.nav { backdrop-filter: blur(4px); }',
    ':root { color: light-dark(black, white); }',
    'input::-webkit-scrollbar { width: 8px; }',
    'a[title="::-webkit-scrollbar"], a[data-x=\'::-webkit-scrollbar\'] { color: red; }',
  ].join('\n');
  assert.deepEqual(css(source, NEXT), [
    'text-wrap: pretty@1',
    'backdrop-filter@5',
    'light-dark()@6',
    '::-webkit-scrollbar@7',
  ]);
});

test('fails unacknowledged uses and acknowledgements nothing needs', () => {
  const uses = [
    { file: 'a.css', line: 3, feature: '@starting-style', missing: ['firefox 129'] },
    { file: 'b.css', line: 9, feature: 'backdrop-filter', missing: ['safari 18'] },
  ];
  assert.deepEqual(
    stylesheetFailures(uses, {
      '@starting-style': 'Menus appear without their entry transition.',
      'text-wrap: pretty': 'Paragraphs wrap greedily.',
    }),
    [
      'b.css:9 uses backdrop-filter, missing in safari 18.',
      'scripts/check-css-compat.mjs acknowledges text-wrap: pretty, which no stylesheet needs on this matrix; remove it.',
    ],
  );
});
