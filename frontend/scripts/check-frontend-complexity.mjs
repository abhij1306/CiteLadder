/** Enforce the frontend CC/LOC ratchet and reject policy relaxation. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { visitorKeys } from 'oxc-parser';

import { lineIndex, parseSource } from './source-ast.mjs';

const FRONTEND = path.resolve(import.meta.dirname, '..');
const REPOSITORY = path.resolve(FRONTEND, '..');
const POLICY_PATH = path.join(FRONTEND, 'scripts', 'frontend_complexity_policy.json');
const POLICY_REPOSITORY_PATH = 'frontend/scripts/frontend_complexity_policy.json';
const GIT_EXECUTABLE =
  process.platform === 'win32' ? String.raw`C:\Program Files\Git\cmd\git.exe` : '/usr/bin/git';
const EXPECTED_ROOTS = ['apps/app', 'components', 'lib'];
const ROOT_RENAMES = new Map([['app', 'apps/app']]);
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
function displayName(node, parentName, line, column) {
  if (node.id?.name) return node.id.name;
  if (parentName) return `${parentName}::<anonymous>@${line}:${column}`;
  return `<anonymous>@${line}:${column}`;
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
function isTestFile(file) {
  return (
    /(?:\.test|\.spec)\.(?:ts|tsx|js|jsx)$/.test(file) || file.split(path.sep).includes('__tests__')
  );
}

export function measure(file) {
  const source = fs.readFileSync(file, 'utf8');
  const program = parseSource(source, file);
  const lineOf = lineIndex(source);
  const functions = [];
  // The enclosing binding names an anonymous function, the way the TypeScript
  // walk read the name off the parent node.
  const visit = (node, parentName) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentName);
      return;
    }
    if (typeof node.type !== 'string') return;
    if (isFunction(node)) {
      const line = lineOf(node.start);
      const column = node.start - (source.lastIndexOf('\n', node.start - 1) + 1) + 1;
      functions.push({
        name: displayName(node, parentName, line, column),
        cc: cyclomatic(node),
        line,
      });
    }
    // A binding names only the function it initializes directly. Letting the
    // name flow further would label every nested callback with it, so
    // `const xs = [() => 1]` would report `xs::<anonymous>` instead of a bare
    // position-qualified identity.
    const holder = declaredName(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const value = node[key];
      const direct = holder !== null && isFunction(unwrapFunction(value));
      visit(value, direct ? holder : null);
    }
  };
  visit(program, null);
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
    !hasExactKeys(defaults, 'max_function_cc,max_production_loc,max_test_loc') ||
    defaults.max_function_cc !== 12 ||
    defaults.max_production_loc !== 500 ||
    defaults.max_test_loc !== 800
  )
    throw new Error('frontend complexity defaults must remain CC 12, production 500, test 800 LOC');
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
      const minimum =
        kind === 'functions'
          ? defaults.max_function_cc
          : Math.min(defaults.max_production_loc, defaults.max_test_loc);
      if (ceiling <= minimum) throw new Error(`${kind} exception ${name} must exceed its default`);
    }
}

export function validatePolicy(policy, expectedRoots = EXPECTED_ROOTS) {
  if (
    !hasExactKeys(policy, 'defaults,exceptions,format_version,roots') ||
    policy.format_version !== 1 ||
    !Array.isArray(policy.roots) ||
    !policy.roots.every((root) => typeof root === 'string' && root.length > 0)
  )
    throw new Error('invalid frontend complexity policy shape');
  if (JSON.stringify(policy.roots) !== JSON.stringify(expectedRoots))
    throw new Error('policy roots must remain apps/app, components, lib');
  const defaults = policy.defaults;
  validateDefaults(defaults);
  validateExceptions(policy.exceptions, defaults);
  return policy;
}
export function loadPolicy(file = POLICY_PATH) {
  return validatePolicy(JSON.parse(fs.readFileSync(file, 'utf8')));
}
export function collect(policy) {
  const measurements = {};
  for (const root of policy.roots)
    for (const file of filesUnder(path.join(FRONTEND, root)))
      measurements[path.relative(FRONTEND, file).split(path.sep).join('/')] = measure(file);
  return measurements;
}
export function failuresFor(measurements, policy) {
  const failures = [];
  for (const [file, measurement] of Object.entries(measurements)) {
    const ceiling =
      policy.exceptions.modules[file] ??
      (measurement.test ? policy.defaults.max_test_loc : policy.defaults.max_production_loc);
    if (measurement.loc > ceiling)
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
    else if (
      measurement.loc <=
      (measurement.test ? policy.defaults.max_test_loc : policy.defaults.max_production_loc)
    )
      failures.push(`stale module exception: ${file} is now within the default`);
  }
  for (const key of Object.keys(policy.exceptions.functions)) {
    const separator = key.lastIndexOf('::');
    const measurement = measurements[key.slice(0, separator)];
    const name = key.slice(separator + 2);
    const fn = measurement?.functions.find((candidate) => candidate.name === name);
    if (!fn) failures.push(`stale function exception: ${key} does not exist`);
    else if (fn.cc <= policy.defaults.max_function_cc)
      failures.push(`stale function exception: ${key} is now within the default`);
  }
  return failures;
}
export function policyDiffFailures(base, current) {
  validatePolicy(base, base.roots);
  validatePolicy(current);
  const failures = [];
  const normalizedBaseRoots = base.roots.map((root) => ROOT_RENAMES.get(root) ?? root);
  if (JSON.stringify(normalizedBaseRoots) !== JSON.stringify(current.roots))
    failures.push('application roots changed');
  for (const key of ['max_function_cc', 'max_production_loc', 'max_test_loc'])
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
function policyAtRevision(revision) {
  if (!REVISION.test(revision)) throw new Error(`invalid base revision: ${revision}`);
  return JSON.parse(
    execFileSync(GIT_EXECUTABLE, ['show', `${revision}:${POLICY_REPOSITORY_PATH}`], {
      cwd: REPOSITORY,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
export function main() {
  const baseIndex = process.argv.indexOf('--check-policy-diff');
  if (baseIndex >= 0 && !process.argv[baseIndex + 1])
    throw new Error('--check-policy-diff requires a revision');
  const policy = loadPolicy();
  const measurements = collect(policy);
  const failures = [
    ...failuresFor(measurements, policy),
    ...staleExceptionFailures(measurements, policy),
  ];
  if (baseIndex >= 0) {
    try {
      failures.push(...policyDiffFailures(policyAtRevision(process.argv[baseIndex + 1]), policy));
    } catch (error) {
      const detail = `${error?.stderr ?? ''}${error?.message ?? error}`;
      if (
        !/does not exist in|exists on disk, but not in|path does not exist|pathspec/i.test(detail)
      )
        throw error;
    }
  }
  if (failures.length) {
    console.error(`frontend complexity policy failed (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else console.log(`frontend complexity policy ok (${Object.keys(measurements).length} modules)`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
