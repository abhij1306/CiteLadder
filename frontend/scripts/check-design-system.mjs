import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { textContrastViolations } from './design-system-contrast.mjs';
import {
  appSourceViolations,
  directRadixImportViolations,
  literalColourViolations,
} from './design-system-source-checks.mjs';

const root = resolve(import.meta.dirname, '..');
const tokenOwner = join(root, 'apps', 'app', 'src', 'globals.css');
const sourceExtensions = new Set(['.css', '.ts', '.tsx', '.js', '.mjs']);
const ignored = new Set([
  'node_modules',
  'build',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
]);
const RAW_HEX = /(?<![\w-])#[0-9a-f]{3,8}(?![\w-])/i;
const violations = [];
const scriptSources = [];

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignored.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

for (const path of files(root)) {
  const extension = extname(path);
  if (!sourceExtensions.has(extension) || path === tokenOwner) continue;
  const source = readFileSync(path, 'utf8');
  const label = relative(root, path).replaceAll('\\', '/');
  if (RAW_HEX.test(source))
    violations.push(`${label}: raw colour outside ${relative(root, tokenOwner)}`);
  if (/\.tsx?$/.test(label) && !/\.test\.tsx?$/.test(label)) scriptSources.push({ label, source });
  violations.push(
    ...literalColourViolations(source, label),
    ...directRadixImportViolations(source, label),
  );
}

violations.push(
  ...textContrastViolations(root),
  ...appSourceViolations(
    readFileSync(join(root, 'apps', 'app', 'src', 'app.css'), 'utf8'),
    scriptSources,
  ),
);

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('CiteLadder design-system policy passed.');
