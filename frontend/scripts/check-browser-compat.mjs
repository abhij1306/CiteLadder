import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import browserslist from 'browserslist';
import { lineIndex, parseSource, walk } from './source-ast.mjs';

/**
 * Browser-compatibility gate: fails when browser source uses a web or
 * JavaScript API that a browser in the support matrix lacks.
 *
 * The matrix is the `browserslist` in package.json, the one statement of
 * supported browsers; `apps/app/vite.config.ts` builds for it and
 * `public/browser-support.js` warns the browsers below it. Support data is
 * MDN's browser-compat-data.
 *
 * What it can see without types: global constructors and functions
 * (`new IntersectionObserver`, `structuredClone(...)`), static members
 * (`AbortSignal.any`, `URL.canParse`, `Promise.try`) and members of the
 * well-known global instances (`navigator.clipboard`, `document.startViewTransition`).
 * Instance methods on arbitrary values (`list.toSorted()`) are left to
 * TypeScript, whose `lib` in tsconfig.json stops at the matrix's ECMAScript
 * year.
 */

const BROWSERS = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  safari: 'safari',
  ios_saf: 'safari_ios',
  samsung: 'samsunginternet_android',
};

// Globals that are instances, mapped to the interface BCD files them under.
const GLOBAL_INSTANCES = {
  crypto: 'Crypto',
  document: 'Document',
  history: 'History',
  localStorage: 'Storage',
  location: 'Location',
  navigator: 'Navigator',
  performance: 'Performance',
  screen: 'Screen',
  sessionStorage: 'Storage',
};
const GLOBAL_SCOPES = new Set(['globalThis', 'self', 'window']);

// Browser source: the product app, the MCP app and the code they share.
// Server-only modules (`lib/server`) never reach a reader's browser.
const BROWSER_ROOTS = [
  'apps/app/src',
  'components',
  'lib',
  'packages/contracts/src',
  'packages/mcp-app/src',
];
const SERVER_ONLY = [/^lib\/server\//];
const NOT_SHIPPED = /(?:\.test\.|\.spec\.|\.d\.ts$|\/test\/)/;

function versionNumber(version) {
  return String(version)
    .replace(/^≤/, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = versionNumber(left);
  const b = versionNumber(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** The oldest supported version of each matrix browser, keyed by BCD browser id. */
export function supportMatrix(queries) {
  const matrix = {};
  for (const entry of browserslist(queries)) {
    const [name, version] = entry.split(' ');
    const browser = BROWSERS[name];
    if (!browser) continue;
    if (!matrix[browser] || compareVersions(version, matrix[browser]) < 0) {
      matrix[browser] = version;
    }
  }
  return matrix;
}

// Whether one support statement covers `version`. A partial implementation
// counts: the API exists, which is all a missing-API crash depends on.
function covers(statement, version) {
  const added = statement.version_added;
  if (added === false || added === 'preview' || added === null) return false;
  if (added !== true && compareVersions(added, version) > 0) return false;
  const removed = statement.version_removed;
  return !removed || (removed !== true && compareVersions(removed, version) > 0);
}

// The matrix browsers that lack a feature, as `browser version_added` strings.
function unsupported(feature, matrix) {
  const support = feature?.__compat?.support;
  if (!support) return [];
  const missing = [];
  for (const [browser, oldest] of Object.entries(matrix)) {
    // Flagged, prefixed and renamed support is not support for this code.
    const statements = [support[browser]]
      .flat()
      .filter(
        (statement) =>
          statement && !statement.flags && !statement.prefix && !statement.alternative_name,
      );
    // No data is unknown, not absent; only a recorded gap fails.
    if (!statements.length || statements.every((statement) => statement.version_added === null)) {
      continue;
    }
    if (statements.some((statement) => covers(statement, oldest))) continue;
    const added = statements[0].version_added;
    missing.push(`${browser} ${typeof added === 'string' ? added : 'none'}`);
  }
  return missing;
}

function globalFeature(name) {
  return bcd.api[name] ?? bcd.javascript.builtins[name] ?? bcd.api.Window[name] ?? null;
}

function memberFeature(owner, property) {
  if (GLOBAL_SCOPES.has(owner)) return { label: property, feature: globalFeature(property) };
  const instance = GLOBAL_INSTANCES[owner];
  if (instance) return { label: `${owner}.${property}`, feature: bcd.api[instance]?.[property] };
  const feature =
    bcd.api[owner]?.[`${property}_static`] ??
    bcd.javascript.builtins[owner]?.[property] ??
    bcd.api[owner]?.[property];
  return { label: `${owner}.${property}`, feature };
}

function bindingNames(pattern, names) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        bindingNames(property.type === 'RestElement' ? property.argument : property.value, names);
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) bindingNames(element, names);
      break;
    case 'AssignmentPattern':
      bindingNames(pattern.left, names);
      break;
    case 'RestElement':
      bindingNames(pattern.argument, names);
      break;
    case 'TSParameterProperty':
      bindingNames(pattern.parameter, names);
      break;
    default:
  }
}

// Every name the file declares anywhere. A local `URL` or `history` is not the
// browser's, so the gate leaves it alone rather than guess at scopes.
function declaredNames(program) {
  const names = new Set();
  walk(program, (node) => {
    switch (node.type) {
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        names.add(node.local.name);
        break;
      case 'VariableDeclarator':
        bindingNames(node.id, names);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) names.add(node.id.name);
        for (const parameter of node.params) bindingNames(parameter, names);
        break;
      case 'ClassDeclaration':
        if (node.id) names.add(node.id.name);
        break;
      case 'CatchClause':
        bindingNames(node.param, names);
        break;
      default:
    }
  });
  return names;
}

/** Each API in `source` that a matrix browser lacks, once per API. */
export function compatViolations(source, label, matrix) {
  const program = parseSource(source, label);
  const declared = declaredNames(program);
  const lineOf = lineIndex(source);
  const found = new Map();
  const report = (api, feature, node) => {
    if (found.has(api)) return;
    const missing = unsupported(feature, matrix);
    if (missing.length) found.set(api, { api, line: lineOf(node.start), missing });
  };
  const isGlobal = (node) => node?.type === 'Identifier' && !declared.has(node.name);

  walk(program, (node) => {
    if (
      (node.type === 'NewExpression' || node.type === 'CallExpression') &&
      isGlobal(node.callee)
    ) {
      report(node.callee.name, globalFeature(node.callee.name), node);
    }
    if (node.type === 'MemberExpression' && isGlobal(node.object)) {
      const owner = node.object.name;
      if (!GLOBAL_SCOPES.has(owner) && !GLOBAL_INSTANCES[owner]) {
        report(owner, globalFeature(owner), node);
      }
      if (!node.computed && node.property.type === 'Identifier') {
        const { label: api, feature } = memberFeature(owner, node.property.name);
        report(api, feature, node);
      }
    }
  });
  return [...found.values()];
}

function sourceFiles(root, directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory())
      return entry.name === 'node_modules' ? [] : sourceFiles(root, relative);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [relative] : [];
  });
}

/** Violations across the browser source under `root`, as printable lines. */
export function checkBrowserSource(root, matrix) {
  const failures = [];
  const files = [
    ...BROWSER_ROOTS.flatMap((directory) => sourceFiles(root, directory)),
    'public/browser-support.js',
  ];
  for (const file of files) {
    if (NOT_SHIPPED.test(file) || SERVER_ONLY.some((pattern) => pattern.test(file))) continue;
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const violation of compatViolations(source, file, matrix)) {
      failures.push(
        `${file}:${violation.line} uses ${violation.api}, missing in ${violation.missing.join(', ')}.`,
      );
    }
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const queries = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).browserslist;
  const failures = checkBrowserSource(root, supportMatrix(queries));
  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(
      'These APIs are newer than the browserslist in package.json. Use an older API, or raise the matrix with an owner decision.',
    );
    process.exit(1);
  }
  console.log('Browser compatibility gate passed.');
}
