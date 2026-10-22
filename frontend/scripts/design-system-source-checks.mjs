import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { visitorKeys } from 'oxc-parser';
export { textContrastViolations } from './design-system-contrast.mjs';

import {
  lineIndex,
  nameText,
  parseSource,
  stringFragments,
  stringValue,
  unwrap,
  walk,
} from './source-ast.mjs';

const EDITORIAL_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);
const EDITORIAL_SIZE = /\btext-(?:2xs|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/;
const WEBSITE_CSS = 'apps/app/src/website-type.css';
const TOKEN_CSS = 'apps/app/src/globals.css';

const LINE_TERMINATOR = /[\n\r\p{Zl}\p{Zp}]/u;
const WHITESPACE = /\s/;

function lineTerminatorIndex(text, from) {
  let index = from;
  while (index < text.length && !LINE_TERMINATOR.test(text[index])) index += 1;
  return index;
}

function whitespaceEnd(text, from) {
  let index = from;
  while (index < text.length && WHITESPACE.test(text[index])) index += 1;
  return index;
}

/**
 * Drops `//` comment lines, together with any blank lines before them, in one
 * linear pass: the same text `/^\s*\/\/.*$/gm` removes, without its backtracking.
 */
function withoutLineComments(text) {
  let kept = '';
  let copied = 0;
  for (let lineStart = 0; lineStart <= text.length;) {
    const contentStart = whitespaceEnd(text, lineStart);
    const lineEnd = lineTerminatorIndex(text, contentStart);
    if (text.startsWith('//', contentStart)) {
      kept += text.slice(copied, lineStart);
      copied = lineEnd;
    }
    lineStart = lineEnd + 1;
  }
  return kept + text.slice(copied);
}

function withoutComments(source) {
  return withoutLineComments(source.replace(/\/\*[\s\S]*?\*\//g, ''));
}

const RAW_DURATION = /\b(?:\d+(?:\.\d+)?|\.\d+)m?s\b/;
const RAW_CUBIC_BEZIER = /cubic-bezier\s*\(/;
const RAW_EASING_KEYWORD = /(?<![\w-])(?:ease(?:-in(?:-out)?|-out)?|linear)(?![\w-])/;
const RAW_TIMING_UTILITY = /\b(?:duration|delay)-(?:\d+|\[[\d.]+m?s\])/;
const RAW_EASING_UTILITY = /\bease-(?:in(?:-out)?|out|linear)\b/;
const RAW_TRANSITION_SHORTHAND =
  /\b(?:opacity|transform|color|width|height)\s+(?:\d+(?:\.\d+)?|\.\d+)m?s\b/;

function hasRawTiming(value) {
  return RAW_DURATION.test(value) || RAW_CUBIC_BEZIER.test(value) || RAW_EASING_KEYWORD.test(value);
}

/** Only motion declarations and utilities are policy: measured durations are data. */
export function motionRoleViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || label === TOKEN_CSS || label === WEBSITE_CSS) return [];
  const text = withoutComments(source);
  const declarations = text.matchAll(
    /(?:animation|transition)(?:-(?:duration|delay|timing-function))?\s*:\s*['"]?([^;\n}'"]+)/g,
  );
  if (
    [...declarations].some(([, value]) => hasRawTiming(value)) ||
    RAW_TIMING_UTILITY.test(text) ||
    RAW_EASING_UTILITY.test(text) ||
    RAW_TRANSITION_SHORTHAND.test(text)
  ) {
    return [`${label}: motion must consume duration and easing roles from globals.css`];
  }
  return [];
}

/** Feature recipes cannot suppress or replace the shared keyboard outline. */
export function focusRoleViolations(source, label, ownsProductUi) {
  if (label === TOKEN_CSS) return [];
  const text = withoutComments(source);
  if (/var\(--(?:color-focus(?:-ring)?|focus-ring)\)/.test(text)) {
    return [`${label}: retired focus/glow tokens must migrate to the shared outline`];
  }
  if (!ownsProductUi) return [];
  if (
    /\b(?:focus(?:-visible)?:)?outline-(?:none|\d|\[)|\bfocus(?:-visible)?:ring-/.test(text) ||
    (label.endsWith('.css') &&
      /(?:^|[;{])\s*outline(?:-offset|-color|-style|-width)?\s*:/.test(text))
  ) {
    return [`${label}: keyboard focus belongs to focus-ring, focus-input or focus-frame`];
  }
  return [];
}

/** Detached surfaces are the only consumers of elevation. */
export function shadowRoleViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || label === TOKEN_CSS) return [];
  const text = withoutComments(source);
  const shadows = text.matchAll(/\bshadow-(\[[^\]]+\]|[\w-]+)/g);
  const rawDeclaration =
    label.endsWith('.css') &&
    [...text.matchAll(/box-shadow\s*:([^;]+);/g)].some(
      ([, value]) => !/^(?:none|var\(--shadow-(?:none|overlay|modal)\))$/.test(value.trim()),
    );
  if (
    [...shadows].some(([, role]) => !['none', 'overlay', 'modal'].includes(role)) ||
    rawDeclaration
  ) {
    return [`${label}: elevation must use shadow-none, shadow-overlay or shadow-modal`];
  }
  return [];
}

/** Radius family mismatches are review advice because composition can be intentional. */
export function radiusRoleAdvisories(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.endsWith('.tsx')) return [];
  const roles = {
    Button: 'control',
    Input: 'control',
    Textarea: 'control',
    Select: 'control',
    Card: 'card',
    Panel: 'card',
    Dialog: 'overlay',
    Drawer: 'overlay',
    DropdownContent: 'overlay',
    Tooltip: 'overlay',
  };
  return jsxClassData(source, label).flatMap(({ tag, classes, line }) => {
    const expected = roles[tag];
    if (!expected) return [];
    const mismatch = [
      ...classes.matchAll(/rounded-\[var\(--radius-(control|card|overlay)\)\]/g),
    ].some(([, role]) => role !== expected);
    return mismatch ? [`${label}:${line}: review ${tag} radius; family role is ${expected}`] : [];
  });
}

/** Control owners consume the size ladder; glyph dimensions remain intrinsic. */
export function densityRoleViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.startsWith('components/ui/')) return [];
  const text = withoutComments(source);
  if (
    /--(?:control-height|field-height(?:-lg)?)(?=\))/.test(text) ||
    /\b(?:min-h|h|size)-(?:9|11|\[(?:20|36|44)px\])(?![\w.])/.test(text)
  ) {
    return [`${label}: control heights must consume named density roles`];
  }
  return [];
}

/**
 * Roles the flow stylesheet must define.
 *
 * The role has to exist, because the JSX and the type ladder below refer to it.
 * What it looks like is a design decision: this deliberately does not pin the
 * font-size or letter-spacing a role resolves to, so the type scale can be
 * retuned without editing a gate.
 */
const REQUIRED_WEBSITE_ROLES = [
  '[data-flow-surface]',
  '.flow-actions.safe-bottom',
  '.flow-title',
  '.flow-group-title',
  '.flow-help',
  '.flow-meta',
];

/**
 * Roles whose size must stay ordered relative to each other.
 *
 * This is the consistency the frozen font-size list was really protecting: a
 * page title must not out-size the hero, and body copy must not out-size a
 * heading. Any absolute scale satisfying the order passes.
 */
const WEBSITE_TYPE_LADDER = ['.flow-title', '.flow-group-title', '.flow-help', '.flow-meta'];

/** Geometry roles belong to one ladder in globals.css; no surface re-scales them. */
const SHARED_GEOMETRY_ROLES = ['--radius-control', '--radius-card', '--radius-lg'];

/**
 * Roles that must take their color from a token rather than a literal.
 *
 * Which token is a design decision — moving a role from `--color-secondary` to
 * `--color-muted` is a legitimate change and no longer fails here. Reaching for
 * a raw hex is not, because it escapes theming and the contrast check below.
 */
const TOKEN_COLORED_ROLES = ['.flow-title', '.flow-group-title', '.flow-help', '.flow-meta'];

/** Alternation over literal values, escaped for use inside a RegExp. */
const oneOf = (values) => `(?:${values.map(escapeRegExp).join('|')})`;

/** A class token (with any variant prefixes) whose utility part matches `utility`. */
const classToken = (utility, end) => new RegExp(String.raw`(?<![\w-])(?:[\w-]+:)*` + utility + end);

const TYPE_SIZES = [
  '2xs',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  ...['2', '3', '4', '5', '6', '7', '8', '9'].map((step) => `${step}xl`),
  'label',
  'field',
  'page-title',
  'role-meta',
  'role-body',
  'role-section',
];
const SPACING_UTILITIES = [
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'p',
  'px',
  'py',
  'pt',
  'pb',
  'pl',
  'pr',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mb',
  'ml',
  'mr',
  'ms',
  'me',
];
// Six- and ten-pixel steps, and any arbitrary pixel value.
const OFF_GRID_STEPS = ['1.5', '2.5', '3.5', '7', '9', '11'];
const ARBITRARY_PX = String.raw`\[\d+(?:\.\d+)?px\]`;

const RAW_TYPE_SCALE = classToken(`text-${oneOf(TYPE_SIZES)}`, String.raw`(?![\w-])`);
const RAW_TYPE_METRICS =
  /(?<![\w-])(?:[\w-]+:)*(?:leading-|tracking-|font-(?:display|sans)(?![\w-]))/;
const OFF_GRID_SPACING = classToken(
  `-?${oneOf(SPACING_UTILITIES)}-(?:${oneOf(OFF_GRID_STEPS)}|${ARBITRARY_PX})`,
  String.raw`(?![\w.-])`,
);

function staticBindings(program) {
  const bindings = new Map();
  walk(program, (node) => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      bindings.set(node.id.name, node.init);
    }
  });
  return bindings;
}

function identifierClassFragments(node, bindings, seen) {
  if (seen.has(node.name)) return [];
  const initializer = bindings.get(node.name);
  if (!initializer) return [];
  return classFragments(initializer, bindings, new Set([...seen, node.name]));
}

function memberClassFragments(node, bindings, seen) {
  const target = unwrap(
    node.object?.type === 'Identifier' ? bindings.get(node.object.name) : node.object,
  );
  if (target?.type === 'ObjectExpression') {
    return target.properties.flatMap((property) =>
      property.type === 'Property' ? classFragments(property.value, bindings, seen) : [],
    );
  }
  return classFragments(target, bindings, seen);
}

const childFragments = (children, bindings, seen) =>
  children.flatMap((child) => classFragments(child, bindings, seen));

/** Class fragments per expression type, once literals and wrappers are peeled off. */
const CLASS_FRAGMENT_READERS = {
  Identifier: identifierClassFragments,
  MemberExpression: memberClassFragments,
  CallExpression: (node, bindings, seen) => childFragments(node.arguments, bindings, seen),
  ConditionalExpression: (node, bindings, seen) =>
    childFragments([node.consequent, node.alternate], bindings, seen),
  BinaryExpression: (node, bindings, seen) =>
    childFragments([node.left, node.right], bindings, seen),
  LogicalExpression: (node, bindings, seen) =>
    childFragments([node.left, node.right], bindings, seen),
  ArrayExpression: (node, bindings, seen) => childFragments(node.elements, bindings, seen),
  // Conditional class maps key the class off a flag, so the key is the class.
  ObjectExpression: (node, bindings, seen) =>
    childFragments(
      node.properties.filter((property) => property.type === 'Property').map(({ key }) => key),
      bindings,
      seen,
    ),
  JSXExpressionContainer: (node, bindings, seen) => classFragments(node.expression, bindings, seen),
};

function classFragments(node, bindings, seen = new Set()) {
  if (!node) return [];
  const literal = stringValue(node);
  if (literal !== null) return [literal];
  if (node.type === 'TemplateLiteral') {
    // Both halves matter: the static chunks carry classes directly, and the
    // interpolations can resolve to more through the binding table.
    return [
      ...node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw ?? ''),
      ...childFragments(node.expressions, bindings, seen),
    ];
  }
  const unwrapped = unwrap(node);
  if (unwrapped !== node) return classFragments(unwrapped, bindings, seen);
  const reader = Object.hasOwn(CLASS_FRAGMENT_READERS, node.type)
    ? CLASS_FRAGMENT_READERS[node.type]
    : null;
  return reader ? reader(node, bindings, seen) : [];
}

/** Every prop through which a call site can hand Tailwind classes to a component. */
const CLASS_ATTRIBUTES = new Set([
  'className',
  'rootClassName',
  'contentClassName',
  'bodyClassName',
  'panelClassName',
  'itemClassName',
  'triggerClassName',
]);

function jsxClassData(source, label) {
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const bindings = staticBindings(program);
  const entries = [];
  walk(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    // `className` is not the only way a call site hands classes to a
    // component. `rootClassName="grid gap-6"` slipped past every spacing and
    // type rule for exactly as long as this only looked at one attribute.
    const classAttributes = node.attributes.filter(
      (property) =>
        property.type === 'JSXAttribute' && CLASS_ATTRIBUTES.has(nameText(property.name)),
    );
    for (const classAttribute of classAttributes) {
      entries.push({
        tag: nameText(node.name),
        classes: classAttribute.value
          ? classFragments(classAttribute.value, bindings).join(' ')
          : '',
        line: lineOf(node.start),
      });
    }
  });
  return entries;
}

const SEMANTIC_TEST_CLASSES = new Set([
  'focus-ring',
  'sr-only',
  'tabular-nums',
  'value-placeholder',
]);
/** Utility stems that are presentation whenever a `-` follows them. */
const RAW_STYLE_STEMS = new Set([
  'bg',
  'text',
  'border',
  'rounded',
  'shadow',
  'p',
  'px',
  'py',
  'ps',
  'pe',
  'pt',
  'pb',
  'm',
  'mx',
  'my',
  'ms',
  'me',
  'mt',
  'mb',
  'gap',
  'space',
  'w',
  'h',
  'min',
  'max',
  'z',
  'table',
  'overflow',
  'whitespace',
  'translate',
  'opacity',
  'size',
  'shrink',
  'grow',
  'items',
  'justify',
  'content',
  'place',
  'font',
  'tracking',
  'leading',
  'break',
  'ring',
  'divide',
  'align',
]);
/** Utilities that are presentation on their own. */
const RAW_STYLE_BARE_UTILITIES = new Set(['border', 'rounded', 'shadow']);
/** Utility prefixes that are presentation whatever follows them. */
const RAW_STYLE_PREFIXES = [
  'truncate',
  'sticky',
  'hidden',
  'grid',
  'flex',
  'inline-flex',
  'block',
  'uppercase',
  'lowercase',
];
const ARBITRARY_VALUE_PREFIX = /^\[[^\]]+\]/;

/** Whether a class with its variants stripped starts with a presentation utility. */
function isRawStyleUtility(utility) {
  const dash = utility.indexOf('-');
  return (
    ARBITRARY_VALUE_PREFIX.test(utility) ||
    RAW_STYLE_BARE_UTILITIES.has(utility) ||
    (dash > 0 && RAW_STYLE_STEMS.has(utility.slice(0, dash))) ||
    RAW_STYLE_PREFIXES.some((prefix) => utility.startsWith(prefix))
  );
}

/**
 * A raw style token is an optional `-`, any non-empty `variant:` prefixes, then
 * a presentation utility. Every split point between those prefixes is tried.
 */
function isRawStyleAssertionToken(token) {
  if (isRawStyleUtility(token.startsWith('-') ? token.slice(1) : token)) return true;
  let segmentStart = 0;
  for (
    let colon = token.indexOf(':');
    colon > segmentStart;
    colon = token.indexOf(':', segmentStart)
  ) {
    if (isRawStyleUtility(token.slice(colon + 1))) return true;
    segmentStart = colon + 1;
  }
  return false;
}

function testExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'ParenthesizedExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function memberPropertyName(node) {
  const expression = testExpression(node);
  if (expression?.type !== 'MemberExpression') return '';
  return expression.computed
    ? (stringValue(expression.property) ?? '')
    : nameText(expression.property);
}

function callName(node) {
  const expression = testExpression(node);
  return expression?.type === 'Identifier' ? expression.name : '';
}

function styleAssertion(node) {
  if (node.type !== 'CallExpression') return null;
  const callee = testExpression(node.callee);
  if (callee?.type !== 'MemberExpression') return null;

  let receiver = testExpression(callee.object);
  if (memberPropertyName(receiver) === 'not') {
    receiver = testExpression(receiver.object);
  }
  if (receiver?.type !== 'CallExpression' || callName(receiver.callee) !== 'expect') return null;

  const matcher = memberPropertyName(callee);
  const target = testExpression(receiver.arguments[0]);
  // `expect(el.classList.contains('bg-panel')).toBe(true)` asserts the same
  // visual recipe as `toHaveClass`, but the class sits in the `contains`
  // argument rather than the matcher's, so the tokens have to be read there.
  if (
    target?.type === 'CallExpression' &&
    memberPropertyName(target.callee) === 'contains' &&
    memberPropertyName(testExpression(target.callee)?.object) === 'classList'
  ) {
    return { matcher, arguments: target.arguments };
  }
  if (matcher !== 'toHaveClass' && memberPropertyName(target) !== 'className') return null;
  return { matcher, arguments: node.arguments };
}

function staticAssertionText(node) {
  const expression = testExpression(node);
  if (stringValue(expression) !== null) return [stringValue(expression)];
  // Only an expression-free template is static text. One with interpolations
  // hides the class behind a runtime value, so it has to read as dynamic —
  // returning its quasis would let `` `${cls}` `` pass as an empty assertion.
  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw ?? '');
  }
  return [];
}

function isSemanticTestClass(token) {
  return SEMANTIC_TEST_CLASSES.has(token) || /^flow-|(?:-hook)$/.test(token);
}

function rawStyleAssertionTokens(text) {
  return text
    .split(/\s+/)
    .filter((token) => token && !isSemanticTestClass(token) && isRawStyleAssertionToken(token));
}

/** Tests assert contracts and consistency, never a frozen presentation recipe. */
export function styleAssertionViolations(source, label) {
  if (!/(?:\.test|\.spec)\./.test(label)) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const violations = [];

  walk(program, (node) => {
    const assertion = styleAssertion(node);
    if (!assertion) return;
    const staticText = assertion.arguments.flatMap(staticAssertionText);
    const hasDynamicArgument = assertion.arguments.some(
      (argument) => staticAssertionText(argument).length === 0,
    );
    const rawTokens = staticText.flatMap(rawStyleAssertionTokens);
    if (hasDynamicArgument || rawTokens.length > 0) {
      const detail = rawTokens.length > 0 ? ` (${rawTokens.join(', ')})` : '';
      violations.push(
        `${label}:${lineOf(node.start)}: visual class assertions${detail} must not freeze presentation; assert contracts or semantic roles`,
      );
    }
  });

  return violations;
}

export function editorialTypographyViolations(source, label, ownsWebsiteEditorialCopy) {
  if (!ownsWebsiteEditorialCopy || !label.endsWith('.tsx')) return [];
  return jsxClassData(source, label)
    .filter((entry) => EDITORIAL_TAGS.has(entry.tag) && EDITORIAL_SIZE.test(entry.classes))
    .map(
      (entry) =>
        label +
        ':' +
        entry.line +
        ': editorial headings and paragraphs must use named website roles',
    );
}

/** Product data absence must name its state instead of rendering punctuation alone. */
export function standalonePlaceholderViolations(source, label, ownsProductUi) {
  if (!ownsProductUi) return [];
  const violations = [];
  const literalStandaloneDash = /(['"`])—\1/g;
  const jsxStandaloneDash = />\s*—\s*</g;
  if (literalStandaloneDash.test(source) || jsxStandaloneDash.test(source)) {
    violations.push(`${label}: standalone em-dash placeholder; use semantic availability copy`);
  }
  return violations;
}

const outsideUiPackage = (label) => !label.startsWith('components/ui/');

/**
 * Independent class rules for product UI. Each rule inspects one JSX element's
 * class string; `appliesTo` scopes it by file, `test` decides the violation.
 */
const PRODUCT_UI_CLASS_RULES = [
  {
    test: (classes, entry) =>
      entry.tag === 'Card' &&
      /\b(?:border(?:-[^\s]+)?|rounded(?:-[^\s]+)?|(?:hover:)?shadow-[^\s]+)\b/.test(classes),
    message: 'Card geometry and elevation belong to its owner',
  },
  // Call sites consume role-owned typography; the owner chooses its weights.
  {
    appliesTo: outsideUiPackage,
    test: (classes) => /\bfont-(?:normal|medium|semibold|bold)\b/.test(classes),
    message: 'font weight belongs to a text role (components/ui/typography.tsx)',
  },
  // A bordered, filled, padded box is a Panel. Twenty-seven of these were
  // rebuilt by hand, each with its own fill, border colour, radius and
  // padding, which is why the same evidence box looked different in six
  // screens. Card could not absorb them — a Card may not nest in a Card — so
  // panelClasses is the owner. Chips, icon tiles and controls are excluded by
  // requiring an all-sides padding.
  {
    appliesTo: outsideUiPackage,
    test: (classes) =>
      /(?<![:\w\]-])bg-(?:panel|well|background-alt)(?:\/\d+)?\b/.test(classes) &&
      /(?<![:\w\]-])border(?![-\w])/.test(classes) &&
      /(?<![:\w\]-])rounded-\[var\(--radius-(?:control|card|overlay)\)\]/.test(classes) &&
      /(?<![:\w\]-])p-(?:\d[\d.]*|\[var\([^)]+\)\])/.test(classes),
    message: 'a bordered filled box is a Panel (components/ui/panel.tsx)',
  },
  // Vertical rhythm belongs to the container. A child that sets its own
  // `mt-*` owns its distance from a sibling it cannot see, which is why
  // ninety-odd of these accumulated in a dozen values and why changing a
  // screen's rhythm meant editing every child taking part in it. Use `Stack`
  // or a `gap`.
  //
  // Exempt: a className that also sizes a glyph (`size-*`), which is optical
  // alignment against a text baseline rather than rhythm; negative margins,
  // which are deliberate overlap; and 2px, which is too small to be rhythm.
  {
    appliesTo: outsideUiPackage,
    test: (classes) =>
      !/(?<![:\w\]-])size-[0-9.]+\b/.test(classes) &&
      /(?<![:\w\]-])(?:mt|mb|my)-(?!0\b|0\.5\b|px\b)[0-9.]+\b/.test(classes),
    message: 'vertical rhythm belongs to a container gap (components/ui/layout.tsx)',
  },
  {
    test: (classes) => /\btext-\[[^\]]+\]/.test(classes),
    message: 'product type must use shared semantic type roles',
  },
  // The type ladder is the `.type-*` roles in globals.css, reached through
  // `textRole()` or the class itself. A raw size, leading, tracking or face
  // at a call site is a private rung of the ladder: that is how a caption
  // came to out-size the value it described.
  {
    appliesTo: outsideUiPackage,
    test: (classes) => RAW_TYPE_SCALE.test(classes),
    message: 'text size belongs to a type role (components/ui/typography.tsx)',
  },
  {
    appliesTo: outsideUiPackage,
    test: (classes) => RAW_TYPE_METRICS.test(classes),
    message: 'leading, tracking and face belong to a type role (components/ui/typography.tsx)',
  },
  {
    test: (classes) => /(?<![\w-])(?:[\w-]+:)*text-subtle(?![\w-])/.test(classes),
    message: 'the subtle ink is retired; labels and meta use muted',
  },
  // Spacing is the 4px grid (2px only as a hairline inset). Six- and
  // ten-pixel steps are how one screen's rhythm stopped matching the next.
  {
    test: (classes) => OFF_GRID_SPACING.test(classes),
    message: 'spacing must sit on the 4px grid',
  },
  // A line is a token at full strength: an alpha-faded edge is an eleventh
  // grey that no longer matches the separation ladder.
  {
    test: (classes) => /(?<![\w-])(?:[\w-]+:)*border-[a-z-]+\/\d+(?![\w-])/.test(classes),
    message: 'borders use a line token, never a faded colour',
  },
  {
    test: (classes) => /\b(?:(?:sm|md|lg|xl):)?(?:gap|p|px|py)-[568]\b/.test(classes),
    message: 'product large spacing must use a semantic CSS variable',
  },
  {
    appliesTo: outsideUiPackage,
    test: (classes) => /\b(?:hover:)?shadow-(?:xs|sm|card|card-hover|lg)\b/.test(classes),
    message: 'feature-owned static elevation is retired',
  },
  {
    test: (classes) =>
      /\b(?:bg|text|border|ring)-(?:gray|indigo|cyan|coral|lime|amber)-\d+\b/.test(classes),
    message: 'product UI must consume semantic colour roles',
  },
];

/** Product UI must consume the even type ladder and semantic large-spacing roles. */
export function productUiSourceViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.endsWith('.tsx')) return [];
  const violations = [];
  for (const entry of jsxClassData(source, label)) {
    for (const rule of PRODUCT_UI_CLASS_RULES) {
      if (rule.appliesTo && !rule.appliesTo(label)) continue;
      if (rule.test(entry.classes, entry)) {
        violations.push(`${label}:${entry.line}: ${rule.message}`);
      }
    }
  }
  return violations;
}

/** Cards are semantic objects, never layout containers nested inside each other. */
export function nestedCardViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.endsWith('.tsx')) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const violations = [];
  // Depth has to thread through the recursion, so this walks locally rather
  // than through the shared depth-free helper.
  const visit = (node, cardDepth) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, cardDepth);
      return;
    }
    if (typeof node.type !== 'string') return;
    const opening = node.type === 'JSXElement' ? node.openingElement : null;
    const isCard = opening ? nameText(opening.name) === 'Card' : false;
    if (isCard && cardDepth > 0) {
      violations.push(`${label}:${lineOf(opening.start)}: Card must not be nested inside Card`);
    }
    const nextDepth = cardDepth + (isCard ? 1 : 0);
    for (const key of visitorKeys[node.type] ?? []) visit(node[key], nextDepth);
  };
  visit(program, 0);
  return violations;
}

/**
 * A card header lays out its actions through `CardHeader actions={…}`. The
 * retired shape re-laid the header out at each call site (`flex-row`,
 * `justify-between`), so every card's title row sat differently.
 */
const CARD_HEADER_LAYOUT = /(?:^|\s)(?:[\w-]+:)*(?:flex-row|justify-between|items-center)(?=\s|$)/;

/** A row a direct child lays out inside the header, beside or instead of `actions`. */
const CARD_HEADER_CHILD_ROW = /(?:^|\s)(?:[\w-]+:)*(?:flex-row|justify-between)(?=\s|$)/;

function classNameMatches(opening, pattern) {
  const className = opening.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && nameText(attribute.name) === 'className',
  );
  if (!className?.value) return false;
  return stringFragments(className.value).some(({ text }) => pattern.test(text));
}

export function cardHeaderLayoutViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.endsWith('.tsx') || label.startsWith('components/ui/')) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const violations = [];
  const report = (node) =>
    violations.push(
      `${label}:${lineOf(node.start)}: CardHeader lays out its own row; pass the trailing controls as actions={…}`,
    );
  walk(program, (node) => {
    if (node.type !== 'JSXElement' || nameText(node.openingElement.name) !== 'CardHeader') return;
    if (classNameMatches(node.openingElement, CARD_HEADER_LAYOUT)) report(node.openingElement);
    for (const child of node.children) {
      if (
        child.type === 'JSXElement' &&
        classNameMatches(child.openingElement, CARD_HEADER_CHILD_ROW)
      )
        report(child.openingElement);
    }
  });
  return violations;
}

const BUTTON_COLOR_ROLE =
  /^text-(?:foreground|secondary|muted|subtle|accent|danger|success|warning|info|on-|inverse)/;

function cosmeticButtonToken(token) {
  const utility = token.split(':').at(-1) ?? token;
  return (
    utility.startsWith('rounded') ||
    utility.startsWith('bg-') ||
    utility === 'border' ||
    utility.startsWith('border-') ||
    utility.startsWith('shadow') ||
    utility.startsWith('opacity-') ||
    utility.startsWith('scale-') ||
    utility.startsWith('transition') ||
    utility.startsWith('duration-') ||
    utility.startsWith('ease-') ||
    BUTTON_COLOR_ROLE.test(utility)
  );
}

/** Product controls must route behavior and appearance through shared owners. */
const RAW_PRODUCT_CONTROL_MESSAGES = new Map([
  ['select', 'native select must use components/ui/select'],
  ['input', 'raw product input must use a components/ui owner'],
  ['textarea', 'raw product textarea must use components/ui/textarea'],
  ['button', 'raw product button must use Button or Pressable'],
]);

function hasCosmeticButtonOverride(node, bindings) {
  const classAttribute = node.attributes.find(
    (property) => property.type === 'JSXAttribute' && nameText(property.name) === 'className',
  );
  if (!classAttribute) return false;
  return classFragments(classAttribute.value, bindings)
    .join(' ')
    .split(/\s+/)
    .some(cosmeticButtonToken);
}

export function productControlViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.endsWith('.tsx') || label.startsWith('components/ui/')) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const bindings = staticBindings(program);
  const violations = [];
  walk(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    const tag = nameText(node.name);
    const line = lineOf(node.start);
    const rawControlMessage = RAW_PRODUCT_CONTROL_MESSAGES.get(tag);
    if (rawControlMessage) violations.push(`${label}:${line}: ${rawControlMessage}`);
    if (tag === 'Button' && hasCosmeticButtonOverride(node, bindings)) {
      violations.push(
        `${label}:${line}: Button cosmetics belong in its semantic variant, not className`,
      );
    }
  });
  return violations;
}

export function directRadixImportViolations(source, label) {
  return !label.startsWith('components/ui/') && /from\s+['"]@radix-ui\//.test(source)
    ? [`${label}: feature code must use components/ui instead of importing Radix`]
    : [];
}

/**
 * Tailwind v4 generates EVERY utility family from every theme token, so
 * `--color-subtle` / `--color-muted` / `--color-secondary` (the Gray-500/600/700
 * TEXT inks) silently yield usable `bg-*` utilities. `bg-subtle` painted the
 * page-kind score expansion as a dark slate panel with unreadable controls on
 * it, and neither review nor the type system could catch it.
 *
 * This lived as an ESLint `no-restricted-syntax` selector pair until the linter
 * moved to Oxlint, which does not implement that rule. The check belongs here
 * regardless: it is a design-token contract, and this file already owns the
 * others. The AST walk (rather than a source regex) is what the ESLint
 * selectors gave us -- it matches string and template text only, so the rule
 * cannot be tripped by a prose mention in a comment.
 *
 * NOT banned: `bg-foreground` + `text-background` is the deliberate
 * inverse-chip pattern, and `bg-inverse/70` is a white scrim.
 */
const TEXT_ROLE_BACKGROUND = new RegExp(
  // Assembled from fragments so this policy source -- which the walk in
  // check-design-system.mjs also reads -- can never match itself.
  String.raw`(^|\s)${['bg', '-'].join('')}(subtle|secondary|muted)(\s|/|$)`,
);

const TEXT_ROLE_BACKGROUND_MESSAGE =
  'background utility built from a TEXT-role token; use a surface token ' +
  '(bg-background-alt, bg-panel, bg-well, bg-elevated, bg-surface-inverse), ' +
  'a border-scale neutral, or a semantic bg-*-bg';

/** Surfaces must never be painted with a text-ink token. */

/**
 * Radius is a ladder, not a vocabulary: 4 / 8 / 12 / 16 / full. `--radius-control`
 * / `--radius-card` / `--radius-lg` are the three roles, with `rounded-xs` as
 * the micro rung for chart bars, skeletons and inline code, and `rounded-full`
 * for pills.
 *
 * This applies to every surface, not just product UI: the app, login and
 * flow each used to carry their own idea of a rounded corner, so the same
 * button rendered at different radii depending on which page it sat on.
 */
export function rawRadiusViolations(source, label) {
  if (label.includes('.test.') || !/\.(?:tsx|ts)$/.test(label)) return [];
  const violations = [];
  for (const entry of jsxClassData(source, label)) {
    const raw = entry.classes.split(/\s+/).filter(isRawRadiusToken);
    if (raw.length) {
      violations.push(
        `${label}:${entry.line}: ${raw.join(', ')} — radius must use a role token (--radius-control|card|lg), rounded-xs, or rounded-full`,
      );
    }
  }
  return violations;
}

const RADIUS_SIDES = ['t', 'b', 'l', 'r', 's', 'e', 'tl', 'tr', 'bl', 'br', 'ss', 'se', 'es', 'ee'];
const RAW_RADIUS_SIZES = new Set(['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']);
const LOWERCASE_VARIANTS = /^(?:[a-z-]+:)*$/;

/** `variant:rounded`, optionally `-side`, then optionally `-size`: the retired raw radius scale. */
function isRawRadiusToken(token) {
  const utilityStart = token.lastIndexOf(':') + 1;
  if (!LOWERCASE_VARIANTS.test(token.slice(0, utilityStart))) return false;
  const [utility, ...suffixes] = token.slice(utilityStart).split('-');
  if (utility !== 'rounded' || suffixes.length > 2) return false;
  if (suffixes.length === 2) {
    return RADIUS_SIDES.includes(suffixes[0]) && RAW_RADIUS_SIZES.has(suffixes[1]);
  }
  return (
    suffixes.length === 0 || RADIUS_SIDES.includes(suffixes[0]) || RAW_RADIUS_SIZES.has(suffixes[0])
  );
}
const SIZE_UTILITIES = ['w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'size'];
/** A whole class token: variant prefixes, an optional `!`, then `utility-[value]`. */
const arbitraryToken = (utility) =>
  new RegExp(String.raw`^(?:[\w-]+:)*!?` + utility + String.raw`-\[([^\]]+)\]$`);
const ARBITRARY_RADIUS = arbitraryToken(`rounded(?:-${oneOf(RADIUS_SIDES)})?`);
const ARBITRARY_SIZE = arbitraryToken(`-?${oneOf(SIZE_UTILITIES)}`);
const ARBITRARY_STROKE = arbitraryToken('stroke');
const LITERAL_LENGTH = /(?<![\w-])(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)(?![\w-])/;
const STYLE_LENGTH_KEYS = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'top',
  'right',
  'bottom',
  'left',
  'gap',
  'rowGap',
  'columnGap',
  'fontSize',
  'lineHeight',
  'borderRadius',
  'borderWidth',
  'outlineWidth',
  'outlineOffset',
]);
const STYLE_LENGTH_FAMILIES = [/^(?:inset|margin|padding)\w*$/, /^border\w*Radius$/];
const isStyleLengthKey = (key) =>
  STYLE_LENGTH_KEYS.has(key) || STYLE_LENGTH_FAMILIES.some((family) => family.test(key));
const STYLE_COLOUR = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\(/i;

/** Every class-like token in a module's string and template text. */
function classTokens(program, lineOf) {
  return stringFragments(program).flatMap(({ text, start }) => {
    const line = lineOf(start);
    return text
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => ({ token, line }));
  });
}

function styleObjectFindings(node, label, lineOf) {
  const value =
    node.value?.type === 'JSXExpressionContainer' ? unwrap(node.value.expression) : null;
  if (value?.type !== 'ObjectExpression') return [];
  return value.properties.flatMap((property) => {
    if (property.type !== 'Property') return [];
    const key = nameText(property.key) || stringValue(property.key) || '';
    const literal = unwrap(property.value);
    const text = stringValue(literal);
    const raw =
      (key === 'boxShadow' && !(text !== null && /^(?:none|var\(--[\w-]+\))$/.test(text))) ||
      (text !== null && (STYLE_COLOUR.test(text) || LITERAL_LENGTH.test(text))) ||
      (literal?.type === 'Literal' &&
        typeof literal.value === 'number' &&
        literal.value !== 0 &&
        isStyleLengthKey(key));
    if (!raw) return [];
    return [
      {
        rule: 'tsx-style',
        file: label,
        line: lineOf(property.start),
        message: `style ${key} is a literal; use a token or a class role`,
      },
    ];
  });
}

/**
 * Geometry and inline-style escapes the className rules never saw.
 *
 * jsxClassData only follows className props, so `cva()` recipes and exported
 * class constants slipped through. This reads every string and template
 * fragment in the module instead: the arbitrary-value shapes it looks for
 * (`rounded-[6px]`, `w-[240px]`, `stroke-[1.5]`) do not occur in prose.
 * Findings are ratcheted by check-design-system.mjs.
 */
export function tsxGeometryFindings(source, label) {
  if (label.includes('.test.') || !/\.(?:tsx|ts)$/.test(label)) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const findings = [];
  const push = (rule, line, message) => findings.push({ rule, file: label, line, message });
  for (const { token, line } of classTokens(program, lineOf)) {
    const radius = ARBITRARY_RADIUS.exec(token);
    // `inherit` lets an overlay follow its frame's role, so it is not a literal.
    if (radius && !/^(?:var\(--radius-[\w-]+\)|inherit|0)$/.test(radius[1])) {
      push(
        'tsx-radius',
        line,
        `${token} — radius must use a role token, rounded-xs or rounded-full`,
      );
    }
    const size = ARBITRARY_SIZE.exec(token);
    if (size && LITERAL_LENGTH.test(size[1]) && !label.startsWith('components/ui/')) {
      push(
        'tsx-size',
        line,
        `${token} — literal dimensions belong to a components/ui owner or a layout token`,
      );
    }
    if (ARBITRARY_STROKE.test(token)) {
      push('tsx-stroke', line, `${token} — icon stroke weight belongs to the shared .lucide rule`);
    }
  }
  const lucide = new Set();
  walk(program, (node) => {
    if (node.type === 'ImportDeclaration' && node.source?.value === 'lucide-react') {
      for (const specifier of node.specifiers ?? []) lucide.add(specifier.local?.name);
    }
  });
  walk(program, (node) => {
    if (node.type !== 'JSXOpeningElement') return;
    for (const attribute of node.attributes) {
      if (attribute.type !== 'JSXAttribute') continue;
      const name = nameText(attribute.name);
      if (name === 'style') findings.push(...styleObjectFindings(attribute, label, lineOf));
      if (name === 'strokeWidth' && lucide.has(nameText(node.name))) {
        push('tsx-stroke', lineOf(attribute.start), `${nameText(node.name)} strokeWidth override`);
      }
    }
  });
  return findings;
}

/*
 * Atomic layering (docs/design.md §Component recipes, app geometry decision 8).
 * Geometry lives in `components/ui` (atoms, organisms, templates) and the
 * shell in `components/layout`; a feature folder composes them and chooses
 * none of its own. The website (`components/marketing`) keeps its own ladder,
 * and so do the auth and onboarding flows for breakpoints.
 */
const LAYERING_OWNERS = new Set(['ui', 'layout', 'marketing']);
const FLOW_FOLDERS = new Set(['auth', 'onboarding']);
const LAYER_SPACING = /^-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(?:\d|px\b|\[|\()/;
const LAYER_SIZE = /^-?(?:h|w|size)-(?:\d|px\b|\[|\()/;
const LAYER_RADIUS = /^rounded(?:-|$)/;
const LAYER_BREAKPOINT = /^(?:max-)?(?:sm|md|lg|xl|2xl)$|^(?:min|max)-\[/;
const LAYER_GEOMETRY_PROPS = new Set(['size', 'padding']);

/** `variant:variant:utility` split on the colons outside arbitrary brackets. */
function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === '[' || character === '(') depth += 1;
    else if (character === ']' || character === ')') depth -= 1;
    else if (character === ':' && depth === 0) {
      parts.push(token.slice(start, index));
      start = index + 1;
    }
  }
  return { variants: parts, utility: token.slice(start).replace(/^!/, '') };
}

/** The components/ folder a non-test component file belongs to, or null. */
function componentFolder(label) {
  const match = /^components\/([^/]+)\//.exec(label);
  if (!match || /\.(?:test|spec)\.tsx?$/.test(label) || !/\.tsx?$/.test(label)) return null;
  return match[1];
}

/**
 * Geometry a feature folder chose for itself: spacing, sized boxes and radii
 * as utilities (`layer-geometry`), and `size=`/`padding=` props
 * (`layer-size-prop`); and, in every product folder including `ui/` and
 * `layout/`, a breakpoint other than `desktop:` (`layer-breakpoint`).
 * Every one is a violation: the layering debt was burned to zero (app
 * geometry PR 7), so none is ratcheted or baselined and none can regrow.
 */
export function featureLayeringViolations(source, label) {
  const folder = componentFolder(label);
  if (!folder || folder === 'marketing') return [];
  const feature = !LAYERING_OWNERS.has(folder);
  const product = !FLOW_FOLDERS.has(folder);
  if (!feature && !product) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const findings = [];
  const push = (rule, line, message) => findings.push(`${label}:${line}: ${message} [${rule}]`);
  for (const { token, line } of classTokens(program, lineOf)) {
    const { variants, utility } = splitVariants(token);
    if (
      feature &&
      (LAYER_SPACING.test(utility) || LAYER_SIZE.test(utility) || LAYER_RADIUS.test(utility))
    ) {
      push('layer-geometry', line, `${token} — geometry belongs to a components/ui organism`);
    }
    if (product && variants.some((variant) => LAYER_BREAKPOINT.test(variant))) {
      push('layer-breakpoint', line, `${token} — the product's one breakpoint is desktop:`);
    }
  }
  if (!feature) return findings;
  walk(program, (node) => {
    if (node.type !== 'JSXAttribute' || !LAYER_GEOMETRY_PROPS.has(nameText(node.name))) return;
    push(
      'layer-size-prop',
      lineOf(node.start),
      `${nameText(node.name)}= — atoms have one form; a feature never picks a size`,
    );
  });
  return findings;
}

export function textRoleBackgroundViolations(source, label) {
  if (!/\.(?:tsx|ts|mjs|js)$/.test(label)) return [];
  const program = parseSource(source, label);
  const lineOf = lineIndex(source);
  const violations = [];
  walk(program, (node) => {
    const text =
      node.type === 'TemplateElement'
        ? (node.value.cooked ?? node.value.raw ?? '')
        : stringValue(node);
    if (text !== null && TEXT_ROLE_BACKGROUND.test(text)) {
      violations.push(`${label}:${lineOf(node.start)}: ${TEXT_ROLE_BACKGROUND_MESSAGE}`);
    }
  });
  return violations;
}

/** A role's declared font-size in rem, or null when it does not set one. */
function fontSizeRem(rules, selector) {
  const pattern = selectorPattern(selector);
  for (const rule of rules) {
    if (!pattern.test(rule.prelude)) continue;
    const match = /(?:^|[;{]|\s)font-size\s*:\s*([\d.]+)rem/.exec(rule.body);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Shared token completeness and relative scale consistency; absolute appearance is free to change. */
export function productContractViolations(root) {
  const violations = [];
  const css = readFileSync(join(root, ...TOKEN_CSS.split('/')), 'utf8');
  const websiteCss = readFileSync(join(root, ...WEBSITE_CSS.split('/')), 'utf8');
  // Every role the product builds on has to be defined somewhere. The value is
  // the design system's to choose: pinning `--color-accent` to a literal hex
  // meant a rebrand failed a test rather than a review.
  const requiredTokens = [
    '--text-xs',
    '--text-sm',
    '--text-2xl',
    '--content-gutter',
    '--workspace-gap',
    '--compact-gap',
    '--page-section-gap',
    '--card-padding',
    '--modal-padding',
    '--control-height-md',
    '--menu-item-height',
    '--badge-height-sm',
    '--control-height-lg',
    '--radius-control',
    '--radius-card',
    '--radius-lg',
    '--color-background',
    '--color-background-alt',
    '--color-panel-tonal',
    '--color-well',
    '--color-active',
    '--color-accent',
    '--color-selection',
    '--color-selection-fg',
  ];
  for (const token of requiredTokens) {
    if (!new RegExp(escapeRegExp(token) + String.raw`\s*:\s*[^;]+;`).test(css)) {
      violations.push(`${TOKEN_CSS}: ${token} must be defined`);
    }
  }
  // The type ladder is ordered even though its absolute sizes are free.
  const TYPE_SCALE = ['--text-xs', '--text-sm', '--text-2xl'];
  const scale = TYPE_SCALE.map((token) => {
    const match = new RegExp(escapeRegExp(token) + String.raw`\s*:\s*([\d.]+)rem`).exec(css);
    return { token, size: match ? Number(match[1]) : null };
  }).filter((step) => step.size !== null);
  for (let index = 1; index < scale.length; index += 1) {
    if (scale[index].size <= scale[index - 1].size) {
      violations.push(
        `${TOKEN_CSS}: ${scale[index].token} must be larger than ${scale[index - 1].token}`,
      );
    }
  }
  if (/\.website-type\b/.test(css + websiteCss)) {
    violations.push(`${TOKEN_CSS}: retired .website-type palette boundary must not return`);
  }
  // The class itself is gone from the shell, so guarding only the palette-override
  // shape would be an assertion that can never fire. Keep the namespace retired.
  if (/\.product-app\b/.test(css)) {
    violations.push(`${TOKEN_CSS}: the retired product-app palette scope must not return`);
  }

  return violations;
}

/** The index just past the `}` that balances the `{` at `open`, or -1 when unbalanced. */
function blockEnd(text, open) {
  let depth = 1;
  let close = open + 1;
  while (close < text.length && depth > 0) {
    if (text[close] === '{') depth += 1;
    if (text[close] === '}') depth -= 1;
    close += 1;
  }
  return depth === 0 ? close : -1;
}

function cssRules(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const open = clean.indexOf('{', cursor);
    if (open === -1) break;
    const prelude = clean.slice(cursor, open).trim();
    const close = blockEnd(clean, open);
    if (close === -1) break;
    if (prelude && !prelude.startsWith('@')) {
      rules.push({ prelude, body: clean.slice(open + 1, close - 1) });
    }
    cursor = close;
  }
  return rules;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, String.raw`\$&`);
}

function selectorPattern(selector) {
  return new RegExp(escapeRegExp(selector) + String.raw`(?![\w-])`);
}

function missingRoleViolations(rules, cssLabel) {
  const violations = [];
  for (const selector of REQUIRED_WEBSITE_ROLES) {
    if (!rules.some((candidate) => candidate.prelude.trim() === selector)) {
      violations.push(cssLabel + ': missing website selector ' + selector);
    }
  }
  return violations;
}

function typeLadderViolations(rules, cssLabel) {
  const violations = [];
  const ladder = WEBSITE_TYPE_LADDER.map((selector) => ({
    selector,
    size: fontSizeRem(rules, selector),
  })).filter((step) => step.size !== null);
  for (let index = 1; index < ladder.length; index += 1) {
    const previous = ladder[index - 1];
    const current = ladder[index];
    if (current.size > previous.size) {
      violations.push(
        cssLabel +
          ': ' +
          current.selector +
          ' (' +
          current.size +
          'rem) must not be larger than ' +
          previous.selector +
          ' (' +
          previous.size +
          'rem)',
      );
    }
  }
  return violations;
}

export function websiteContractViolations(root) {
  const violations = [];
  const cssPath = join(root, ...WEBSITE_CSS.split('/'));
  const cssLabel = relative(root, cssPath).replaceAll('\\', '/');
  const rules = cssRules(readFileSync(cssPath, 'utf8'));

  violations.push(
    ...missingRoleViolations(rules, cssLabel),
    ...typeLadderViolations(rules, cssLabel),
  );

  for (const selector of TOKEN_COLORED_ROLES) {
    const selectorRegex = selectorPattern(selector);
    const scoped = rules.filter((rule) => selectorRegex.test(rule.prelude));
    const colors = scoped.flatMap((rule) => [
      ...rule.body.matchAll(/(?:^|[;{]|\s)color\s*:([^;]+)/g),
    ]);
    if (!colors.length) {
      violations.push(cssLabel + ': ' + selector + ' must declare a color');
      continue;
    }
    for (const [, value] of colors) {
      if (!/var\(\s*--/.test(value)) {
        violations.push(
          cssLabel + ': ' + selector + ' must take its color from a token, not ' + value.trim(),
        );
      }
    }
  }

  for (const role of SHARED_GEOMETRY_ROLES) {
    if (new RegExp(escapeRegExp(role) + String.raw`\s*:`).test(readFileSync(cssPath, 'utf8'))) {
      violations.push(
        cssLabel + ': ' + role + ' is a shared geometry role and must not be redefined per surface',
      );
    }
  }

  return violations;
}

/**
 * The app's Tailwind scans only the `@source` directories in app.css, so a
 * class used only in an unlisted directory is silently never generated: the
 * element renders unstyled. Every component directory that listed code
 * imports must itself be listed. `files` are `{ label, source }` with labels
 * relative to frontend/.
 */
export function appSourceViolations(appCss, files) {
  const listed = [...appCss.matchAll(/@source\s+'\.\.\/\.\.\/\.\.\/([^']+)'/g)].map(([, path]) =>
    path.replace(/\/$/, ''),
  );
  const covered = (label) => listed.some((path) => label === path || label.startsWith(`${path}/`));
  const missing = new Map();
  for (const { label, source } of files) {
    if (!covered(label)) continue;
    for (const [, name] of source.matchAll(/from '@\/components\/([\w-]+)\//g)) {
      const directory = `components/${name}`;
      if (!covered(directory) && !missing.has(directory)) missing.set(directory, label);
    }
  }
  return [...missing].map(
    ([directory, label]) =>
      `apps/app/src/app.css: ${directory} (imported by ${label}) is missing from @source, so its classes are never generated`,
  );
}
