import { visitorKeys } from 'oxc-parser';
export { textContrastViolations } from './design-system-contrast.mjs';

import {
  classFragments,
  jsxClassData,
  oneOf,
  staticBindings,
} from './design-system-class-data.mjs';
import {
  lineIndex,
  nameText,
  parseSource,
  stringFragments,
  stringValue,
  walk,
} from './source-ast.mjs';

export const TOKEN_CSS = 'apps/app/src/globals.css';

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
  if (!ownsProductUi || label === TOKEN_CSS) return [];
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

/** The system's five shadows (and none) are the whole elevation vocabulary. */
const SHADOW_ROLES = new Set(['none', 'edge', 'xs', 'float', 'pop', 'press']);

export function shadowRoleViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || label === TOKEN_CSS) return [];
  const text = withoutComments(source);
  const shadows = text.matchAll(/\bshadow-(\[[^\]]+\]|[\w-]+)/g);
  const rawDeclaration =
    label.endsWith('.css') &&
    [...text.matchAll(/box-shadow\s*:([^;]+);/g)].some(
      ([, value]) => !/^(?:none|var\(--shadow-(?:edge|xs|float|pop|press)\))$/.test(value.trim()),
    );
  if ([...shadows].some(([, role]) => !SHADOW_ROLES.has(role)) || rawDeclaration) {
    return [
      `${label}: elevation must use shadow-edge, shadow-xs, shadow-float, shadow-pop, shadow-press or none`,
    ];
  }
  return [];
}

/** Radius family mismatches are review advice because composition can be intentional. */
export function radiusRoleAdvisories(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.endsWith('.tsx')) return [];
  // The system's radius per component family: controls 12, app surfaces 14.
  const roles = {
    Button: 'md',
    Input: 'md',
    Textarea: 'md',
    Select: 'md',
    Card: 'lg',
    Panel: 'lg',
    Dialog: 'lg',
    Drawer: 'lg',
    DropdownContent: 'lg',
  };
  return jsxClassData(source, label).flatMap(({ tag, classes, line }) => {
    const expected = roles[tag];
    if (!expected) return [];
    const mismatch = [...classes.matchAll(/(?<![\w-])rounded-(2xs|xs|sm|md|lg|xl)(?![\w-])/g)].some(
      ([, size]) => size !== expected,
    );
    return mismatch
      ? [`${label}:${line}: review ${tag} radius; its family is rounded-${expected}`]
      : [];
  });
}

/** Control owners consume the size ladder; glyph dimensions remain intrinsic. */
export function densityRoleViolations(source, label, ownsProductUi) {
  if (!ownsProductUi || !label.startsWith('components/ui/')) return [];
  const text = withoutComments(source);
  if (
    /--(?:control-height|field-height)/.test(text) ||
    /\b(?:min-h|h|size)-(?:9|11|\[(?:20|28|36|44|48)px\])(?![\w.])/.test(text)
  ) {
    return [`${label}: control heights must consume --control-sm, --control-md or --control-lg`];
  }
  return [];
}

/** A class token (with any variant prefixes) whose utility part matches `utility`. */
const classToken = (utility, end) => new RegExp(String.raw`(?<![\w-])(?:[\w-]+:)*` + utility + end);

/** Every `--text-*` role in globals.css, plus Tailwind's own scale names. */
const TYPE_SIZES = [
  '2xs',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  ...['2', '3', '4', '5', '6', '7', '8', '9'].map((step) => `${step}xl`),
  'display-2xl',
  'display-xl',
  'display-lg',
  'display-md',
  'title',
  'title-sm',
  'stat',
  'lead',
  'body-lg',
  'body',
  'body-sm',
  'label',
  'label-lg',
  'heading',
  'caption',
  'eyebrow',
  'data',
  'code',
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
  /(?<![\w-])(?:[\w-]+:)*(?:leading-|tracking-|font-(?:display|sans|mono)(?![\w-]))/;
const OFF_GRID_SPACING = classToken(
  `-?${oneOf(SPACING_UTILITIES)}-(?:${oneOf(OFF_GRID_STEPS)}|${ARBITRARY_PX})`,
  String.raw`(?![\w.-])`,
);

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
      /(?<![:\w\]-])bg-(?:surface|surface-sunken|paper)(?:\/\d+)?(?![\w-])/.test(classes) &&
      /(?<![:\w\]-])border(?![-\w])/.test(classes) &&
      /(?<![:\w\]-])rounded-(?:sm|md|lg|xl)(?![\w-])/.test(classes) &&
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
    test: (classes) =>
      /\bwebsite-(?:hero|page|section|feature|small|lead|body|nav|label)/.test(classes) ||
      /(?<![\w-])cl-(?:phero-title|lhero-title|shead-title|fcard-title|lead|body|note)(?![\w-])/.test(
        classes,
      ),
    message: 'product UI must not consume website type roles',
  },
  {
    appliesTo: outsideUiPackage,
    test: (classes) =>
      /(?<![\w-])(?:hover:)?shadow-(?:xs|sm|float|lg|press)(?![\w-])/.test(classes),
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

const BUTTON_COLOR_ROLE = /^text-(?:ink|accent|positive|negative|warning|info|on-)/;

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
 * `--color-ink-secondary` / `--color-ink-muted` / `--color-accent-ink` (TEXT
 * inks) silently yield usable `bg-*` utilities. A text-ink background once
 * painted the page-kind score expansion as a dark slate panel with unreadable
 * controls on it, and neither review nor the type system could catch it.
 *
 * The check lives here because it is a design-token contract, and this file
 * already owns the others. It walks the AST rather than matching source text:
 * it reads string and template text only, so the rule cannot be tripped by a
 * prose mention in a comment.
 *
 * NOT banned: `bg-ink` + `text-on-ink` is the primary button and the
 * inverse-chip pattern.
 */
const TEXT_ROLE_BACKGROUND = new RegExp(
  // Assembled from fragments so this policy source -- which the walk in
  // check-design-system.mjs also reads -- can never match itself.
  String.raw`(^|\s)${['bg', '-'].join('')}(ink-secondary|ink-muted|accent-ink|subtle|secondary|muted)(\s|/|$)`,
);

const TEXT_ROLE_BACKGROUND_MESSAGE =
  'background utility built from a TEXT-role token; use a surface token ' +
  '(bg-paper, bg-surface, bg-surface-sunken, bg-ink) or a semantic bg-*-soft';

/** Surfaces must never be painted with a text-ink token. */

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
