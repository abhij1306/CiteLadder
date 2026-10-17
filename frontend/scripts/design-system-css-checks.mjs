import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

/**
 * Declaration-level policy for hand-written CSS outside the token owner.
 *
 * Tailwind classes are read by design-system-source-checks.mjs; this module
 * reads the stylesheets those checks never saw.
 * Every finding is `{ rule, file, line, message }` and is judged by the
 * ratchet (design-system-ratchet.mjs), so existing debt stays visible while a
 * file may only lower its count.
 */

const TOKEN_CSS = 'apps/app/src/globals.css';
const WEBSITE_CSS = 'apps/app/src/website-type.css';
const SCANNED_ROOTS = ['apps', 'components'];
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.dev', 'coverage']);

const RADIUS_PROPERTY = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
const SPACING_PROPERTY =
  /^(?:(?:padding|margin|inset)(?:-[a-z-]+)?|gap|row-gap|column-gap|top|right|bottom|left)$/;
const MOTION_PROPERTY = /^(?:transition|animation)(?:-(?:duration|timing-function|delay))?$/;
const OUTLINE_PROPERTY = /^outline(?:-(?:color|style|width|offset))?$/;
const EASING_KEYWORDS = new Set([
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
]);
const EASING_FUNCTIONS = new Set(['cubic-bezier', 'steps', 'linear']);
const WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * The flow ladder owners: these roles define the onboarding type scale, so
 * their literal sizes are the scale itself, not a deviation from it.
 */
const TYPE_ROLE_PART = /^\.flow-(?:title|group-title|help|meta)$/;
// Only the flow surface may own a base size.
const FLOW_SCALE_SELECTOR = ':where([data-flow-surface])';

const RULE_MESSAGES = {
  'css-radius': 'radius must be var(--radius-*) or 0',
  'css-type': 'font-size and line-height must consume a var(--text-*) role',
  'css-spacing': 'spacing must sit on the 4px grid (2px and below only for hairline insets)',
  'css-motion': 'timing must consume var(--motion-*) and var(--ease-*)',
  'css-outline': 'focus outlines belong to the shared focus rule in globals.css',
  'css-shadow': 'box-shadow must be var(--shadow-*), var(--elevation-*) or a 1px token hairline',
  'css-cycle': 'a custom property must not reference itself',
};

const isVar = (node) => node.type === 'function' && node.value === 'var';
const varName = (node) => node.nodes.find((child) => child.type === 'word')?.value ?? '';

/** Top-level value nodes, without separators. */
const topLevel = (value) =>
  valueParser(value).nodes.filter((node) => node.type !== 'space' && node.type !== 'comment');

/** Comma-separated layers, each a list of its top-level nodes. */
function layers(value) {
  const result = [[]];
  for (const node of valueParser(value).nodes) {
    if (node.type === 'div' && node.value === ',') result.push([]);
    else if (node.type !== 'space' && node.type !== 'comment') result.at(-1).push(node);
  }
  return result;
}

/** Literal dimensions anywhere in a value, skipping var() and its fallback. */
function literalDimensions(value) {
  const found = [];
  valueParser(value).walk((node) => {
    if (isVar(node)) return false;
    if (node.type !== 'word') return undefined;
    const unit = valueParser.unit(node.value);
    if (unit && Number(unit.number) !== 0) found.push(node.value);
    return undefined;
  });
  return found;
}

function radiusAllowed(value) {
  if (literalDimensions(value).length) return false;
  return topLevel(value).every(
    (node) =>
      (node.type === 'div' && node.value === '/') ||
      (isVar(node) && varName(node).startsWith('--radius-')) ||
      (node.type === 'word' && (node.value === '0' || WIDE_KEYWORDS.has(node.value))) ||
      (node.type === 'function' && node.value === 'calc'),
  );
}

function typeAllowed(property, value) {
  const nodes = topLevel(value);
  if (nodes.length !== 1) return false;
  const [node] = nodes;
  if (isVar(node)) return varName(node).startsWith('--text-');
  if (node.type !== 'word') return false;
  if (WIDE_KEYWORDS.has(node.value)) return true;
  // Relative to the surrounding text, not a rung: inline code scales with the
  // heading or paragraph it sits in.
  if (property === 'font-size') return valueParser.unit(node.value)?.unit === 'em';
  // A superscript collapses its line box so it never opens up the line.
  return ['0', '1', 'normal'].includes(node.value);
}

/** Pixel size of a px or rem literal, or null for any other word. */
function pixels(word) {
  const unit = valueParser.unit(word);
  if (!unit) return null;
  if (unit.unit === 'px') return Math.abs(Number(unit.number));
  if (unit.unit === 'rem') return Math.abs(Number(unit.number) * 16);
  return null;
}

// calc(), var(), clamp() and percentages express intent, not a step; only
// the top-level literals are judged.
function offGridSteps(value) {
  return topLevel(value)
    .filter((node) => node.type === 'word')
    .filter((node) => {
      const size = pixels(node.value);
      return size !== null && size > 2 && size % 4 !== 0;
    })
    .map((node) => node.value);
}

function rawTiming(value) {
  const found = [];
  valueParser(value).walk((node) => {
    if (isVar(node)) return false;
    if (node.type === 'function' && EASING_FUNCTIONS.has(node.value)) {
      found.push(`${node.value}()`);
      return false;
    }
    if (node.type !== 'word') return undefined;
    const unit = valueParser.unit(node.value);
    const duration = unit && (unit.unit === 'ms' || unit.unit === 's') && Number(unit.number) !== 0;
    if (duration || EASING_KEYWORDS.has(node.value)) found.push(node.value);
    return undefined;
  });
  return found;
}

/** A layer that draws a 1px token-coloured ring or rule rather than depth. */
function hairlineLayer(nodes) {
  const words = nodes.filter((node) => node.type === 'word').map((node) => node.value);
  const colours = nodes.filter((node) => isVar(node));
  if (colours.length !== 1 || !varName(colours[0]).startsWith('--color-')) return false;
  if (nodes.at(-1) !== colours[0]) return false;
  const geometry = words[0] === 'inset' ? words.slice(1) : words;
  const shape = geometry.join(' ');
  // The 2px rules are the tab underline, the one documented thicker hairline.
  return [
    '0 0 0 1px',
    '0 1px 0',
    '0 -1px 0',
    '0 1px 0 0',
    '0 -1px 0 0',
    '0 -2px 0',
    '0 2px 0',
  ].includes(shape);
}

function shadowAllowed(value) {
  const parts = layers(value);
  if (parts.length === 1 && parts[0].length === 1 && parts[0][0].type === 'word') {
    return parts[0][0].value === 'none' || WIDE_KEYWORDS.has(parts[0][0].value);
  }
  return parts.every(
    (nodes) =>
      (nodes.length === 1 &&
        isVar(nodes[0]) &&
        /^--(?:shadow|elevation)-/.test(varName(nodes[0]))) ||
      hairlineLayer(nodes),
  );
}

function outlineAllowed(property, value) {
  return property === 'outline' && ['none', '0'].includes(value.trim());
}

/** True when every selector of the rule is a flow ladder owner. */
function ownsTypeLadder(rule, label) {
  if (label !== WEBSITE_CSS || !rule?.selector) return false;
  if (rule.selector.replace(/\s+/g, ' ').trim() === FLOW_SCALE_SELECTOR) return true;
  const unwrapped = rule.selector.replace(/^:where\(([\s\S]*)\)$/, '$1');
  return unwrapped
    .split(',')
    .map((part) => part.trim())
    .every((part) => TYPE_ROLE_PART.test(part));
}

function enclosingRule(node) {
  let current = node.parent;
  while (current && current.type !== 'rule') current = current.parent;
  return current;
}

/** Every literal of a value that breaks its rule, as a finding detail. */
const listedFinding = (rule, property, found) =>
  found.length ? [rule, `${property}: ${found.join(' ')}`] : null;

/**
 * Per-property-family policy, first match wins: `finding(property, value,
 * decl, label)` returns `[rule, detail]` or null when the value is allowed.
 */
const PROPERTY_FAMILIES = [
  {
    matches: (property) => RADIUS_PROPERTY.test(property),
    finding: (property, value) => (radiusAllowed(value) ? null : ['css-radius', value]),
  },
  {
    matches: (property) => property === 'font-size' || property === 'line-height',
    finding: (property, value, decl, label) =>
      typeAllowed(property, value) || ownsTypeLadder(enclosingRule(decl), label)
        ? null
        : ['css-type', `${property}: ${value}`],
  },
  {
    matches: (property) => SPACING_PROPERTY.test(property),
    finding: (property, value) => listedFinding('css-spacing', property, offGridSteps(value)),
  },
  {
    matches: (property) => MOTION_PROPERTY.test(property),
    finding: (property, value) => listedFinding('css-motion', property, rawTiming(value)),
  },
  {
    matches: (property) => OUTLINE_PROPERTY.test(property),
    finding: (property, value) =>
      outlineAllowed(property, value) ? null : ['css-outline', `${property}: ${value}`],
  },
  {
    matches: (property) => property === 'box-shadow',
    finding: (property, value) => (shadowAllowed(value) ? null : ['css-shadow', value]),
  },
];

function declarationFinding(decl, label) {
  const property = decl.prop.toLowerCase();
  // A custom property that reads itself is a cycle: the browser drops it and
  // every consumer silently falls back to the inherited value.
  if (property.startsWith('--')) {
    return decl.value.includes(`var(${decl.prop})`)
      ? ['css-cycle', `${decl.prop}: ${decl.value}`]
      : null;
  }
  const family = PROPERTY_FAMILIES.find(({ matches }) => matches(property));
  return family ? family.finding(property, decl.value, decl, label) : null;
}

/**
 * Policy findings for one stylesheet.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function cssPolicyFindings(css, label) {
  if (label === TOKEN_CSS) return [];
  let root;
  try {
    root = postcss.parse(css, { from: label });
  } catch (error) {
    return [
      {
        rule: 'css-parse',
        file: label,
        line: error.line ?? 1,
        message: `could not parse CSS — ${error.reason ?? error.message}`,
      },
    ];
  }
  const findings = [];
  root.walkDecls((decl) => {
    const finding = declarationFinding(decl, label);
    if (!finding) return;
    const [rule, detail] = finding;
    findings.push({
      rule,
      file: label,
      line: decl.source?.start?.line ?? 1,
      message: `${detail.replace(/\s+/g, ' ').trim()} — ${RULE_MESSAGES[rule]}`,
    });
  });
  return findings;
}

function stylesheetPaths(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (IGNORED_DIRECTORIES.has(name)) return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return stylesheetPaths(path);
    return /\.css$/.test(name) ? [path] : [];
  });
}

/** Every CSS policy finding under apps/ and components/. */
export function cssPolicyScan(root) {
  return SCANNED_ROOTS.flatMap((directory) => stylesheetPaths(join(root, directory))).flatMap(
    (path) => {
      const label = relative(root, path).replaceAll('\\', '/');
      const source = readFileSync(path, 'utf8');
      return cssPolicyFindings(source, label);
    },
  );
}
