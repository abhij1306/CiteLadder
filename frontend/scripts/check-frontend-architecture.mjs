import fs from 'node:fs';
import path from 'node:path';

import {
  isApiSource,
  nonNullCount,
  nonNullRatchetFailures,
  typeDisciplineFindings,
} from './type-discipline-checks.mjs';

const root = process.cwd();
const failures = [];

for (const owner of [
  'ai-traffic.ts',
  'auth.ts',
  'integrations.ts',
  'opportunities.ts',
  'performance.ts',
  'projects.ts',
  'prompts.ts',
  'providers.ts',
  'runs.ts',
  'visibility.ts',
]) {
  if (!fs.existsSync(path.join(root, 'lib', 'api', owner))) {
    failures.push(`lib/api/${owner} is missing.`);
  }
}

const NAVIGATION_OWNERS = new Set(['lib/navigation/hard-navigate.ts']);
const HARD_NAVIGATION = /location\s*\.\s*(?:assign|replace)\s*\(|location\s*\.\s*href\s*=[^=]/;

function sourceFiles(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'build'].includes(entry.name)) return [];
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

for (const file of ['app', 'components', 'lib'].flatMap(sourceFiles)) {
  if (NAVIGATION_OWNERS.has(file) || file.includes('.test.')) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  if (HARD_NAVIGATION.test(code)) {
    failures.push(`${file} navigates the browser directly; use lib/navigation/hard-navigate.ts.`);
  }
}

for (const file of sourceFiles('lib/api')) {
  if (file.includes('.test.')) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (/\bz\s*\.\s*(?:object|strictObject|looseObject)\s*\(/.test(source)) {
    failures.push(`${file} declares an API object schema outside packages/contracts.`);
  }
}

const facade = path.join(root, 'lib', 'api', 'index.ts');
if (fs.existsSync(facade)) {
  const source = fs.readFileSync(facade, 'utf8');
  if (/\bfetch\s*\(/.test(source) || /from\s+['"]\.\/client['"]/.test(source)) {
    failures.push('lib/api/index.ts must not own transport.');
  }
}

const NON_NULL_BASELINE = path.join(root, 'scripts', 'non-null-baseline.json');
const nonNullCounts = {};
for (const file of ['apps', 'components', 'lib', 'packages', 'services'].flatMap(sourceFiles)) {
  if (/\.(?:test|spec)\.tsx?$|\.d\.ts$|\/(?:test|e2e|generated)\//.test(file)) continue;
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const { line, message } of typeDisciplineFindings(source, file))
    failures.push(`${file}:${line}: ${message}`);
  if (isApiSource(file)) {
    const count = nonNullCount(source, file);
    if (count) nonNullCounts[file] = count;
  }
}
const nonNullFailures = nonNullRatchetFailures(
  nonNullCounts,
  JSON.parse(fs.readFileSync(NON_NULL_BASELINE, 'utf8')),
);
failures.push(...nonNullFailures);
if (process.argv.includes('--write-non-null-baseline') && !nonNullFailures.length)
  fs.writeFileSync(NON_NULL_BASELINE, `${JSON.stringify(nonNullCounts, null, 2)}\n`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Frontend architecture guard passed.');
