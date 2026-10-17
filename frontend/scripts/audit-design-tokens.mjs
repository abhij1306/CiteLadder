import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import postcss from 'postcss';

import { paletteDeclarations, resolvePalette } from './design-system-contrast.mjs';
import { parseSource, stringFragments } from './source-ast.mjs';

/**
 * Token audit: globals.css stays the sole value authority, and this reads it.
 *
 *   (no flag)  print the colour inventory with each token's consumers
 *   --check    fail on duplicate values and unconsumed tokens
 */

const root = resolve(import.meta.dirname, '..');
const TOKEN_CSS = 'apps/app/src/globals.css';
const LIGHT = ':root';
const DARK = ":root[data-theme='dark']";
const THEMES = [
  ['light', LIGHT],
  ['dark', DARK],
];
const CONSUMER_ROOTS = ['apps', 'components', 'lib'];
const ignored = new Set([
  'node_modules',
  'dist',
  'build',
  '.dev',
  'coverage',
  'test-results',
  'playwright-report',
]);

/** Families every declared token must have a consumer in. */
const AUDITED_FAMILY = /^--(?:color|tag|radius|shadow|elevation|motion|ease|text)-/;

/**
 * Colour tokens that deliberately share a value in a theme. Two tokens with
 * the same resolved value are otherwise one role under two names: either
 * alias one to the other with `var()`, or record the reason here.
 */
const SAME_AS = [
  {
    theme: 'light',
    tokens: [
      '--color-panel',
      '--color-elevated',
      '--color-input',
      '--color-on-inverse',
      '--color-accent-fg',
      '--color-danger-fg',
    ],
    reason:
      'paper, layers, fields and labels on solid fills are one white in light; dark splits them',
  },
  {
    theme: 'light',
    tokens: ['--color-border-subtle', '--color-track'],
    reason: 'the recessed track is drawn in the hairline tone in light',
  },
  {
    theme: 'dark',
    tokens: ['--color-background', '--color-on-inverse'],
    reason: 'a label on the dark inverse surface is cut out in the ground colour',
  },
  {
    theme: 'dark',
    tokens: ['--color-input', '--color-track'],
    reason: 'fields and selection tracks share one recessed fill in dark',
  },
];

/** Status and action values a chart series must never wear. */
const NON_SERIES =
  /^--color-(?:accent(?:-[\w-]+)?|(?:success|warning|danger|info|neutral)(?:-[\w-]+)?)$/;

const byName = (left, right) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignored.has(name)) return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(?:css|tsx?|astro)$/.test(path) || /\.(?:test|spec)\./.test(path)) return [];
    return [{ path: relative(root, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }];
  });
}

/**
 * Read-only inventory; globals.css remains the sole value authority.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function tokenInventory(source) {
  const light = resolvePalette(source, LIGHT);
  const dark = resolvePalette(source, DARK);
  return [...light.keys()]
    .filter((token) => token.startsWith('--color-'))
    .sort(byName)
    .map((token) => ({
      token,
      light: light.get(token),
      dark: dark.get(token),
    }));
}

/** Tokens reached by following `var()` aliases from `token`, itself included. */
function aliasChain(declarations, token) {
  const chain = new Set();
  let current = token;
  while (current && !chain.has(current)) {
    chain.add(current);
    current = declarations.get(current)?.match(/^var\((--[\w-]+)\)$/)?.[1];
  }
  return chain;
}

const sameAsAllowed = (sameAs, theme, first, second) =>
  sameAs.some(
    (group) =>
      group.theme === theme && group.tokens.includes(first) && group.tokens.includes(second),
  );

/** The finding for two colour tokens sharing a value, or null when allowed. */
function pairFinding({ theme, declarations, sameAs, value }, first, second) {
  const series = [first, second].find((token) => token.startsWith('--color-chart-'));
  const other = series === first ? second : first;
  if (series && NON_SERIES.test(other)) {
    return `${TOKEN_CSS}: ${theme} ${series} equals ${other} (${value}); chart series never wear a status or action value`;
  }
  const firstChain = aliasChain(declarations, first);
  if ([...aliasChain(declarations, second)].some((token) => firstChain.has(token))) return null;
  if (sameAsAllowed(sameAs, theme, first, second)) return null;
  return `${TOKEN_CSS}: ${theme} ${first} and ${second} both resolve to ${value}; alias one with var() or record it in SAME_AS`;
}

function themeDuplicateFindings(source, theme, selector, sameAs) {
  const declarations = paletteDeclarations(source, selector);
  const palette = resolvePalette(source, selector);
  const tokens = [...palette.keys()].filter((token) => token.startsWith('--color-')).sort(byName);
  const valueOf = (token) => palette.get(token)?.replace(/\s+/g, ' ').toLowerCase();
  const findings = [];
  for (const [index, first] of tokens.entries()) {
    const value = valueOf(first);
    if (!value) continue;
    for (const second of tokens.slice(index + 1)) {
      if (value !== valueOf(second)) continue;
      const finding = pairFinding({ theme, declarations, sameAs, value }, first, second);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

/**
 * Colour tokens that resolve to one value in a theme without saying so.
 * Chart series may never equal a status or action value, with no exception.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function duplicateTokenFindings(source, sameAs = SAME_AS) {
  return THEMES.flatMap(([theme, selector]) =>
    themeDuplicateFindings(source, theme, selector, sameAs),
  );
}

/** Every custom property globals.css declares in an audited family. */
function declaredTokens(source) {
  const tokens = new Set();
  postcss.parse(source).walkDecls((decl) => {
    if (AUDITED_FAMILY.test(decl.prop) && !decl.prop.includes('*')) tokens.add(decl.prop);
  });
  return tokens;
}

// Longer prefixes precede their stems so `border-x-…` names the x side's colour.
const COLOUR_PREFIXES = [
  'bg',
  'text',
  ...['x', 'y', 't', 'r', 'b', 'l', 's', 'e'].map((side) => `border-${side}`),
  'border',
  'ring-offset',
  'ring',
  'outline',
  'fill',
  'stroke',
  'divide',
  'decoration',
  'caret',
  'placeholder',
  'accent',
  'shadow',
  'inset-shadow',
  'inset-ring',
  'from',
  'via',
  'to',
];
const COLOUR_UTILITY = new RegExp(`^(?:${COLOUR_PREFIXES.join('|')})-(.+)$`);

/** Theme tokens a single Tailwind class can generate from. */
function utilityTokens(className) {
  const utility = className
    .split(':')
    .at(-1)
    .replace(/^[!-]+/, '')
    .replace(/!$/, '')
    .replace(/\/[\w.[\]]+$/, '');
  const tokens = [];
  const colour = COLOUR_UTILITY.exec(utility);
  if (colour) tokens.push(`--color-${colour[1]}`);
  const radius = /^rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-(.+)$/.exec(utility);
  if (radius) tokens.push(`--radius-${radius[1]}`);
  const prefixed = /^(text|shadow|duration|ease)-(.+)$/.exec(utility);
  if (prefixed) {
    const family = { text: 'text', shadow: 'shadow', duration: 'motion', ease: 'ease' };
    tokens.push(`--${family[prefixed[1]]}-${prefixed[2]}`);
  }
  return tokens;
}

/** Literal text of a module: string and template fragments from its AST. */
const moduleStrings = (text, path) =>
  stringFragments(parseSource(text, path)).map((fragment) => fragment.text);

/** Every token name a source file consumes, by var(), utility or literal name. */
function consumedTokens({ path, text }) {
  const consumed = new Set();
  for (const [, token] of text.matchAll(/var\(\s*(--[\w-]+)/g)) consumed.add(token);
  const strings = /\.tsx?$/.test(path) ? moduleStrings(text, path) : [text];
  for (const value of strings) {
    for (const [token] of value.matchAll(/(?<![\w-])--[a-z][\w-]*/g)) {
      // A bare name in TS is a lookup (`getPropertyValue('--color-x')`); in
      // CSS the same match is a declaration, which is not consumption.
      if (/\.tsx?$/.test(path)) consumed.add(token);
    }
    for (const className of value.split(/[\s"'`{}();,]+/)) {
      for (const token of utilityTokens(className)) consumed.add(token);
    }
  }
  return consumed;
}

/** The `--text-*` token a `--text-…--modifier` companion travels with. */
function textCompanion(token) {
  if (!token.startsWith('--text-')) return undefined;
  const split = token.indexOf('--', '--text-'.length);
  if (split < 0) return undefined;
  const base = token.slice(0, split);
  const modifier = token.slice(split + 2);
  return /^--text-\w+(?:-[a-z\d]+)*$/.test(base) && /^[\w-]+$/.test(modifier) ? base : undefined;
}

/**
 * Declared tokens that no source file consumes.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function zeroConsumerTokens(source, files) {
  const consumed = new Set();
  for (const file of files) for (const token of consumedTokens(file)) consumed.add(token);
  return [...declaredTokens(source)]
    .filter((token) => {
      if (consumed.has(token)) return false;
      // `--text-sm--line-height` travels with the `text-sm` utility.
      const companion = textCompanion(token);
      return !(companion && consumed.has(companion));
    })
    .sort(byName);
}

/** Everything --check enforces, as violation strings. */
export function tokenAuditViolations(base = root) {
  const tokenCss = readTokenCss(base);
  const files = CONSUMER_ROOTS.flatMap((directory) => sourceFiles(join(base, directory)));
  return [
    ...duplicateTokenFindings(tokenCss),
    ...zeroConsumerTokens(tokenCss, files).map(
      (token) => `${TOKEN_CSS}: ${token} has no consumer; remove it or use it`,
    ),
  ];
}

const readTokenCss = (base) => readFileSync(join(base, TOKEN_CSS), 'utf8');

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv.slice(2).find((argument) => argument.startsWith('--'));
  if (mode === '--check') {
    const violations = tokenAuditViolations();
    if (violations.length) {
      console.error(violations.join('\n'));
      process.exit(1);
    }
    console.log('Design tokens are unique and consumed.');
  } else {
    const tokenCss = readTokenCss(root);
    const files = CONSUMER_ROOTS.flatMap((directory) => sourceFiles(join(root, directory)));
    // The same consumption rule the --check gate applies.
    const consumption = files.map((file) => ({ path: file.path, tokens: consumedTokens(file) }));
    const rows = tokenInventory(tokenCss).map((row) => ({
      ...row,
      consumers: consumption.filter(({ tokens }) => tokens.has(row.token)).map(({ path }) => path),
    }));
    console.log(JSON.stringify(rows, null, 2));
  }
}
