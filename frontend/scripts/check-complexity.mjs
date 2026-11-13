/**
 * Enforce the function CC and test-file LOC ratchets of the frontend and the
 * API service, and reject policy relaxation. `--policy frontend|api` selects
 * the policy. Production source size is check-token-size.mjs's rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { visitorKeys } from 'oxc-parser';

import { lineIndex, parseSource } from './source-ast.mjs';

const FRONTEND = path.resolve(import.meta.dirname, '..');
const REPOSITORY = path.resolve(FRONTEND, '..');
const GIT_EXECUTABLE =
  process.platform === 'win32' ? String.raw`C:\Program Files\Git\cmd\git.exe` : '/usr/bin/git';
/** Each policy's file below `frontend/`, its fixed roots and its historical root renames. */
export const POLICIES = {
  frontend: {
    file: 'scripts/frontend_complexity_policy.json',
    roots: ['apps/app', 'components', 'lib'],
    renames: new Map([['app', 'apps/app']]),
  },
  api: {
    file: 'services/api/complexity-policy.json',
    roots: ['services/api/src', 'services/api/scripts', 'services/api/test'],
    renames: new Map(),
  },
};
/**
 * Directories below a root that no ratchet measures: kysely-codegen writes them
 * and `db:types:check` verifies them, so no one maintains them by hand.
 */
const GENERATED_DIRECTORIES = ['services/api/src/generated/'];
const REVISION = /^(?:HEAD|[0-9a-fA-F]{40})$/;
// ESTree names for the kinds the TypeScript walk counted. Accessors and
// constructors are `MethodDefinition` wrappers around a FunctionExpression
// here, so counting the inner function keeps the per-function tally the same.
const FUNCTION_KINDS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
// `SwitchCase` covers both CaseClause and DefaultClause, so a `default:` arm
// adds a point where the TypeScript walk also counted one.
const BRANCH_KINDS = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'CatchClause',
  'ConditionalExpression',
  'SwitchCase',
]);
const BRANCH_OPERATORS = new Set(['&&', '||', '??']);

function isFunction(node) {
  return FUNCTION_KINDS.has(node.type);
}
function cyclomatic(node) {
  let score = 1;
  // Nested functions carry their own score, so the walk stops at their border.
  const visit = (child) => {
    if (!child || typeof child !== 'object') return;
    if (Array.isArray(child)) {
      for (const item of child) visit(item);
      return;
    }
    if (typeof child.type !== 'string') return;
    if (isFunction(child)) return;
    if (BRANCH_KINDS.has(child.type)) score += 1;
    if (child.type === 'LogicalExpression' && BRANCH_OPERATORS.has(child.operator)) score += 1;
    for (const key of visitorKeys[child.type] ?? []) visit(child[key]);
  };
  for (const key of visitorKeys[node.type] ?? []) visit(node[key]);
  return score;
}
/** The identifier a declaration binds a function to, if it is one of those. */
function declaredName(node) {
  if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') return node.id.name;
  if (
    node.type === 'MethodDefinition' ||
    node.type === 'PropertyDefinition' ||
    node.type === 'Property'
  ) {
    return node.key?.name ?? node.key?.value ?? null;
  }
  return null;
}
/** See through the wrappers that sit between a binding and its function. */
function unwrapFunction(node) {
  let current = node;
  while (
    current &&
    typeof current === 'object' &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ParenthesizedExpression')
  ) {
    current = current.expression;
  }
  return current && typeof current === 'object' ? current : {};
}
/**
 * A function's identity within its file, which exceptions key on. It holds no
 * line or column, so an edit elsewhere in the file keeps every identity: a
 * function is named by its own name or the binding that holds it, an anonymous
 * one by its enclosing function, and a repeated name by its occurrence (`#2`).
 */
function baseName(node, bindingName, enclosing) {
  if (node.id?.name) return node.id.name;
  if (bindingName) return bindingName;
  return enclosing ? `${enclosing}::<anonymous>` : '<anonymous>';
}
function filesUnder(root) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          'node_modules',
          '.next',
          'dist',
          'out',
          'coverage',
          'playwright-report',
          'test-results',
        ].includes(entry.name)
      )
        continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
        result.push(absolute);
    }
  }
  visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}
/**
 * A test, or a helper in a test directory (the API service keeps its fixtures
 * in `test/`). Only the path below `frontend/` counts, so a checkout under a
 * directory named `test` does not raise every module to the test ceiling.
 */
function isTestFile(file) {
  const below = path.relative(FRONTEND, file);
  const outside = below.startsWith('..') || path.isAbsolute(below);
  const segments = new Set(outside ? [] : below.split(path.sep));
  return (
    /(?:\.test|\.spec)\.(?:ts|tsx|js|jsx)$/.test(file) ||
    segments.has('__tests__') ||
    segments.has('test')
  );
}

export function measure(file) {
  const source = fs.readFileSync(file, 'utf8');
  const program = parseSource(source, file);
  const lineOf = lineIndex(source);
  const functions = [];
  const seen = new Map();
  const visit = (node, bindingName, enclosing) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, bindingName, enclosing);
      return;
    }
    if (typeof node.type !== 'string') return;
    let scope = enclosing;
    if (isFunction(node)) {
      const base = baseName(node, bindingName, enclosing);
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      scope = occurrence === 1 ? base : `${base}#${occurrence}`;
      functions.push({ name: scope, cc: cyclomatic(node), line: lineOf(node.start) });
    }
    // A binding names only the function it initializes directly. Letting the
    // name flow further would label every nested callback with it, so
    // `const xs = [() => 1]` would name the callback `xs`.
    const holder = declaredName(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const value = node[key];
      const direct = holder !== null && isFunction(unwrapFunction(value));
      visit(value, direct ? holder : null, scope);
    }
  };
  visit(program, null, null);
  return { loc: source.split(/\r?\n/).length, test: isTestFile(file), functions };
}

function hasExactKeys(value, keys) {
  return (
    value &&
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(',') === keys
  );
}

function validateDefaults(defaults) {
  if (
    !hasExactKeys(defaults, 'max_function_cc,max_test_loc') ||
    defaults.max_function_cc !== 12 ||
    defaults.max_test_loc !== 800
  )
    throw new Error('complexity defaults must remain CC 12 and test 800 LOC');
}

function validateExceptions(exceptions, defaults) {
  if (
    !hasExactKeys(exceptions, 'functions,modules') ||
    !exceptions.functions ||
    !exceptions.modules ||
    Array.isArray(exceptions.functions) ||
    Array.isArray(exceptions.modules)
  )
    throw new Error('policy exceptions must contain function and module maps');
  for (const [kind, entries] of Object.entries(exceptions))
    for (const [name, ceiling] of Object.entries(entries)) {
      if (!name || typeof ceiling !== 'number' || !Number.isInteger(ceiling) || ceiling <= 0)
        throw new Error(`invalid ${kind} exception: ${name}`);
      const minimum = kind === 'functions' ? defaults.max_function_cc : defaults.max_test_loc;
      if (ceiling <= minimum) throw new Error(`${kind} exception ${name} must exceed its default`);
    }
}

export function validatePolicy(policy, expectedRoots) {
  if (
    !hasExactKeys(policy, 'defaults,exceptions,format_version,roots') ||
    policy.format_version !== 1 ||
    !Array.isArray(policy.roots) ||
    !policy.roots.every((root) => typeof root === 'string' && root.length > 0)
  )
    throw new Error('invalid complexity policy shape');
  if (JSON.stringify(policy.roots) !== JSON.stringify(expectedRoots))
    throw new Error(`policy roots must remain ${expectedRoots.join(', ')}`);
  const defaults = policy.defaults;
  validateDefaults(defaults);
  validateExceptions(policy.exceptions, defaults);
  return policy;
}
export function loadPolicy(name) {
  const { file, roots } = POLICIES[name];
  return validatePolicy(JSON.parse(fs.readFileSync(path.join(FRONTEND, file), 'utf8')), roots);
}
export function collect(policy) {
  const measurements = {};
  for (const root of policy.roots)
    for (const file of filesUnder(path.join(FRONTEND, root))) {
      const relative = path.relative(FRONTEND, file).split(path.sep).join('/');
      if (!GENERATED_DIRECTORIES.some((directory) => relative.startsWith(directory)))
        measurements[relative] = measure(file);
    }
  return measurements;
}
export function failuresFor(measurements, policy) {
  const failures = [];
  for (const [file, measurement] of Object.entries(measurements)) {
    const ceiling = policy.exceptions.modules[file] ?? policy.defaults.max_test_loc;
    if (measurement.test && measurement.loc > ceiling)
      failures.push(`${file}: LOC ${measurement.loc} exceeds ceiling ${ceiling}`);
    for (const fn of measurement.functions) {
      const functionCeiling =
        policy.exceptions.functions[`${file}::${fn.name}`] ?? policy.defaults.max_function_cc;
      if (fn.cc > functionCeiling)
        failures.push(`${file}::${fn.name}: CC ${fn.cc} exceeds ceiling ${functionCeiling}`);
    }
  }
  return failures;
}
export function staleExceptionFailures(measurements, policy) {
  const failures = [];
  for (const file of Object.keys(policy.exceptions.modules)) {
    const measurement = measurements[file];
    if (!measurement) failures.push(`stale module exception: ${file} does not exist`);
    else if (!measurement.test)
      failures.push(`module exception ${file} is not a test; only tests have a LOC ceiling`);
    else if (measurement.loc <= policy.defaults.max_test_loc)
      failures.push(`stale module exception: ${file} is now within the default`);
  }
  for (const key of Object.keys(policy.exceptions.functions)) {
    // A function name may itself hold `::` (an anonymous function's enclosing name); a path never does.
    const separator = key.indexOf('::');
    const measurement = measurements[key.slice(0, separator)];
    const name = key.slice(separator + 2);
    const fn = measurement?.functions.find((candidate) => candidate.name === name);
    if (!fn) failures.push(`stale function exception: ${key} does not exist`);
    else if (fn.cc <= policy.defaults.max_function_cc)
      failures.push(`stale function exception: ${key} is now within the default`);
  }
  return failures;
}
export function policyDiffFailures(base, current, name) {
  const { roots, renames } = POLICIES[name];
  // The base may predate the current shape, so only shared keys are compared.
  validatePolicy(current, roots);
  const failures = [];
  const normalizedBaseRoots = base.roots.map((root) => renames.get(root) ?? root);
  if (JSON.stringify(normalizedBaseRoots) !== JSON.stringify(current.roots))
    failures.push('application roots changed');
  for (const key of ['max_function_cc', 'max_test_loc'])
    if (current.defaults[key] > base.defaults[key])
      failures.push(`default ${key} increased ${base.defaults[key]} -> ${current.defaults[key]}`);
  for (const kind of ['functions', 'modules'])
    for (const [name, value] of Object.entries(current.exceptions[kind])) {
      if (!(name in base.exceptions[kind]))
        failures.push(`new ${kind.slice(0, -1)} exception is forbidden: ${name}`);
      else if (value > base.exceptions[kind][name])
        failures.push(
          `${kind.slice(0, -1)} exception ${name} increased ${base.exceptions[kind][name]} -> ${value}`,
        );
    }
  return failures;
}
function policyAtRevision(revision, name) {
  if (!REVISION.test(revision)) throw new Error(`invalid base revision: ${revision}`);
  return JSON.parse(
    execFileSync(GIT_EXECUTABLE, ['show', `${revision}:frontend/${POLICIES[name].file}`], {
      cwd: REPOSITORY,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
export function main() {
  const policyIndex = process.argv.indexOf('--policy');
  const name = process.argv[policyIndex + 1];
  if (policyIndex < 0 || !Object.hasOwn(POLICIES, name))
    throw new Error(`--policy must be one of ${Object.keys(POLICIES).join(', ')}`);
  const baseIndex = process.argv.indexOf('--check-policy-diff');
  if (baseIndex >= 0 && !process.argv[baseIndex + 1])
    throw new Error('--check-policy-diff requires a revision');
  const policy = loadPolicy(name);
  const measurements = collect(policy);
  const failures = [
    ...failuresFor(measurements, policy),
    ...staleExceptionFailures(measurements, policy),
  ];
  if (baseIndex >= 0) {
    try {
      const base = policyAtRevision(process.argv[baseIndex + 1], name);
      failures.push(...policyDiffFailures(base, policy, name));
    } catch (error) {
      const detail = `${error?.stderr ?? ''}${error?.message ?? error}`;
      if (
        !/does not exist in|exists on disk, but not in|path does not exist|pathspec/i.test(detail)
      )
        throw error;
    }
  }
  if (failures.length) {
    console.error(`${name} complexity policy failed (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else console.log(`${name} complexity policy ok (${Object.keys(measurements).length} modules)`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
