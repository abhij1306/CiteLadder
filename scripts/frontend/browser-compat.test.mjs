import assert from 'node:assert/strict';
import test from 'node:test';

import { compatViolations, supportMatrix } from '../../frontend/scripts/check-browser-compat.mjs';

// The raised matrix (AR-8) and the one it replaced.
const RAISED = supportMatrix([
  'chrome >= 120',
  'edge >= 120',
  'firefox >= 128',
  'safari >= 17.4',
  'ios_saf >= 17.4',
  'samsung >= 25',
]);
const PREVIOUS = supportMatrix([
  'chrome >= 111',
  'edge >= 111',
  'firefox >= 128',
  'safari >= 16.4',
  'ios_saf >= 16.4',
  'samsung >= 23',
]);

const apis = (source, matrix) =>
  compatViolations(source, 'lib/example.ts', matrix).map(({ api, line }) => `${api}@${line}`);

test('reads the oldest version of each matrix browser', () => {
  assert.deepEqual(RAISED, {
    chrome: '120',
    edge: '120',
    firefox: '128',
    safari: '17.4',
    safari_ios: '17.4',
    samsunginternet_android: '25',
  });
});

test('passes the APIs the raised matrix admits and fails them on the previous one', () => {
  const source =
    'const signal = AbortSignal.any([a, b]);\nconst valid = URL.canParse(value);\nconst copy = structuredClone(value);';
  assert.deepEqual(apis(source, RAISED), []);
  assert.deepEqual(apis(source, PREVIOUS), ['AbortSignal.any@1', 'URL.canParse@2']);
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
