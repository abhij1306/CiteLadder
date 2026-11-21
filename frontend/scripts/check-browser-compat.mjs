import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import { supportMatrix, unsupported } from './browser-support-data.mjs';
import { checkStylesheets } from './check-css-compat.mjs';
import { lineIndex, parseSource, walk } from './source-ast.mjs';

export { supportMatrix };
export { cssCompatViolations, stylesheetFailures } from './check-css-compat.mjs';

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

function optionallyUsed(program) {
  const guarded = new Set();
  walk(program, (node) => {
    if (node.type === 'MemberExpression' && node.optional) guarded.add(node.object);
    if (node.type === 'CallExpression' && node.optional) guarded.add(node.callee);
  });
  return guarded;
}

export function compatViolations(source, label, matrix) {
  const program = parseSource(source, label);
  const declared = declaredNames(program);
  const guarded = optionallyUsed(program);
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
      isGlobal(node.callee) &&
      !guarded.has(node.callee)
    ) {
      report(node.callee.name, globalFeature(node.callee.name), node);
    }
    if (node.type === 'MemberExpression' && isGlobal(node.object) && !guarded.has(node)) {
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
  const matrix = supportMatrix(queries);
  const failures = [...checkBrowserSource(root, matrix), ...checkStylesheets(root, matrix)];
  if (failures.length) {
    console.error(failures.join('\n'));
    console.error(
      'These features are newer than the browserslist in package.json. Use an older one, guard it (`?.` in scripts, `@supports` in CSS), acknowledge a CSS enhancement that degrades acceptably in check-css-compat.mjs, or raise the matrix with an owner decision.',
    );
    process.exit(1);
  }
  console.log('Browser compatibility gate passed.');
}
