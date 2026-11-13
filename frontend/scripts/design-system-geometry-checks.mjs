import { classTokens, jsxClassData, oneOf } from './design-system-class-data.mjs';
import { lineIndex, nameText, parseSource, stringValue, unwrap, walk } from './source-ast.mjs';

/**
 * Radius is the system's scale and nothing else: `rounded-2xs` (2, chart bars,
 * rungs), `-xs` (6, badges, checkboxes), `-sm` (8, tabs in a track, menu
 * items), `-md` (12, buttons, inputs, code), `-lg` (14, app cards, menus,
 * dialogs), `-xl` (20, product frames) and `-full`. No
 * arbitrary value, not even a `var()`.
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
        `${label}:${entry.line}: ${raw.join(', ')} — radius must be rounded-2xs, -xs, -sm, -md, -lg, -xl or -full`,
      );
    }
  }
  return violations;
}

const RADIUS_SIDES = ['t', 'b', 'l', 'r', 's', 'e', 'tl', 'tr', 'bl', 'br', 'ss', 'se', 'es', 'ee'];
/** The system's radius scale: the only sizes a `rounded-*` utility may name. */
const SYSTEM_RADII = new Set(['2xs', 'xs', 'sm', 'md', 'lg', 'xl', 'full']);
const LOWERCASE_VARIANTS = /^(?:[a-z-]+:)*$/;

/**
 * `variant:rounded`, optionally `-side`, then a size outside the system's
 * scale, no size at all, or an arbitrary `[value]` (even a `var()`): a corner
 * the system does not name.
 */
function isRawRadiusToken(token) {
  const utilityStart = token.lastIndexOf(':') + 1;
  if (!LOWERCASE_VARIANTS.test(token.slice(0, utilityStart))) return false;
  const utility = token.slice(utilityStart).replace(/^!/, '');
  if (!/^rounded(?:-|$)/.test(utility)) return false;
  // `inherit` lets an overlay follow its frame's corner, so it names no value.
  if (/^rounded(?:-[a-z]+)?-\[/.test(utility)) return !utility.endsWith('-[inherit]');
  const suffixes = utility.split('-').slice(1);
  if (suffixes.length === 2) {
    return !(RADIUS_SIDES.includes(suffixes[0]) && SYSTEM_RADII.has(suffixes[1]));
  }
  if (suffixes.length === 1) return !SYSTEM_RADII.has(suffixes[0]);
  return true;
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
    // `inherit` lets an overlay follow its frame's corner, so it is not a literal.
    if (radius && !/^(?:inherit|0)$/.test(radius[1])) {
      push('tsx-radius', line, `${token} — radius must be one of the system's rounded-* sizes`);
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
 * Atomic layering (app geometry decision 8).
 * Geometry lives in `components/ui` (atoms, organisms, templates) and the
 * shell in `components/layout`; a feature folder composes them and chooses
 * none of its own. The auth and onboarding flows keep their own ladder for
 * breakpoints.
 */
const LAYERING_OWNERS = new Set(['ui', 'layout']);
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
 * `layout/`, a breakpoint other than `desktop:` and the shell's `shell:`
 * (`layer-breakpoint`).
 * Every one is a violation: the layering debt was burned to zero (app
 * geometry PR 7), so none is ratcheted or baselined and none can regrow.
 */
export function featureLayeringViolations(source, label) {
  const folder = componentFolder(label);
  if (!folder) return [];
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
      push(
        'layer-breakpoint',
        line,
        `${token} — the product's breakpoints are desktop: and shell:`,
      );
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
