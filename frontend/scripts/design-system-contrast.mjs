import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { composite, contrastRatio, isHex, lightness, separation } from './design-system-color.mjs';

const TOKEN_CSS = 'apps/app/src/globals.css';
const LIGHT = ':root';
const DARK = ":root[data-theme='dark']";
const ALL_SCOPES = [LIGHT, DARK];

const color = (role) => `--color-${role}`;
const STATUSES = ['success', 'warning', 'danger', 'info'];
const OUTCOME_MARKS = [...STATUSES, 'neutral'].map(color);
const TAGS = [
  'blue',
  'purple',
  'green',
  'moss',
  'red',
  'orange',
  'amber',
  'teal',
  'yellow',
  'neutral',
];
const CHARTS = Array.from({ length: 8 }, (_, index) => color(`chart-${index + 1}`));

/**
 * The contrast matrix. Each row pairs every ink with every surface at a
 * minimum ratio in the listed scopes. A translucent surface is composited on
 * the scope's panel, and a translucent ink on the surface beneath it.
 */
const CONTRAST_PAIRS = [
  {
    inks: ['foreground', 'secondary', 'muted', 'brand-ink'].map(color),
    surfaces: ['panel', 'background', 'background-alt', 'well'].map(color),
    minimum: 4.5,
    scopes: ALL_SCOPES,
  },
  {
    inks: ['foreground', 'secondary', 'muted'].map(color),
    surfaces: ['panel-tonal', 'active'].map(color),
    minimum: 4.5,
    scopes: ALL_SCOPES,
  },
  ...STATUSES.map((status) => ({
    inks: [color(`${status}-text`)],
    surfaces: [color(`${status}-bg`), color('panel')],
    minimum: 4.5,
    scopes: ALL_SCOPES,
  })),
  ...[
    ['accent-fg', 'accent'],
    ['danger-fg', 'danger-solid'],
    ['on-inverse', 'surface-inverse'],
    ['selection-fg', 'selection'],
  ].map(([ink, surface]) => ({
    inks: [color(ink)],
    surfaces: [color(surface)],
    minimum: 4.5,
    scopes: ALL_SCOPES,
  })),
  ...TAGS.map((tag) => ({
    inks: [`--tag-${tag}-text`],
    surfaces: [`--tag-${tag}-bg`],
    minimum: 4.5,
    scopes: ALL_SCOPES,
  })),
  { inks: CHARTS, surfaces: [color('panel')], minimum: 3, scopes: ALL_SCOPES },
  { inks: [color('border-bold')], surfaces: [color('panel')], minimum: 3, scopes: ALL_SCOPES },
];

/**
 * Marks that must stay distinguishable without full colour vision: by
 * lightness alone, or by hue under both red–green deficiencies.
 */
const MIN_LIGHTNESS_STEP = 15;
const MIN_SIMULATED_DISTANCE = 10;
const SEPARATED_SETS = [
  {
    name: 'outcome marks',
    pairs: OUTCOME_MARKS.flatMap((first, index) =>
      OUTCOME_MARKS.slice(index + 1).map((second) => [first, second]),
    ),
    scopes: ALL_SCOPES,
  },
  {
    name: 'adjacent chart series',
    pairs: CHARTS.slice(1).map((second, index) => [CHARTS[index], second]),
    scopes: ALL_SCOPES,
  },
];
const STATE_LADDER = ['panel', 'hover', 'selected', 'active'].map(color);

function escapeRegExp(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, String.raw`\$&`);
}

/** Top-level rules as `{ selectors, body }`; nested blocks are skipped whole. */
function topLevelRules(clean) {
  const rules = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const open = clean.indexOf('{', cursor);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    while (close < clean.length && depth > 0) {
      if (clean[close] === '{') depth += 1;
      if (clean[close] === '}') depth -= 1;
      close += 1;
    }
    // A preceding at-statement (`@import …;`) is not part of the selector.
    const prelude = clean.slice(cursor, open).split(';').at(-1).trim();
    rules.push({
      selectors: prelude.split(',').map((part) => part.replace(/\s+/g, ' ').trim()),
      body: clean.slice(open + 1, close - 1),
    });
    cursor = close;
  }
  return rules;
}

/**
 * A rule body's own `--token: value;` declarations, skipping nested blocks.
 * Split on `;` rather than scanned with one regex, so parsing stays linear.
 */
function customProperties(body) {
  // A nested block becomes a separator, leaving its prelude as a segment
  // that is not a declaration. CSS may omit the final `;`, so the last
  // segment counts when it is a complete declaration.
  const segments = body.replace(/\{[^{}]*\}/g, ';').split(';');
  return segments.flatMap((segment) => {
    const colon = segment.indexOf(':');
    const token = segment.slice(0, colon).trim();
    const value = segment.slice(colon + 1).trim();
    return colon > 0 && /^--[\w-]+$/.test(token) && value ? [[token, value]] : [];
  });
}

/** The raw declared value of every token a scope sees, before alias resolution. */
export function paletteDeclarations(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = topLevelRules(clean);
  // A scope's declarations come from every top-level rule whose selector list
  // names it exactly, so `:root, [data-flow-surface] {…}` still rebinds.
  const declarations = (scope) =>
    rules
      .filter(({ selectors }) => selectors.includes(scope))
      .flatMap(({ body }) => customProperties(body));
  return new Map([
    ...declarations('@theme'),
    ...declarations(':root'),
    ...(selector === DARK ? declarations(LIGHT) : []),
    ...(selector === ':root' ? [] : declarations(selector)),
  ]);
}

/** Resolve inherited tokens and repeated scoped overrides before checking contrast. */
export function resolvePalette(source, selector) {
  const values = paletteDeclarations(source, selector);
  const resolve = (token, seen = new Set()) => {
    if (seen.has(token)) return undefined;
    seen.add(token);
    const value = values.get(token);
    const alias = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
    if (alias) return resolve(alias, seen);
    const mix = value?.match(/^color-mix\(in srgb, var\((--[\w-]+)\), var\((--[\w-]+)\) (\d+)%\)$/);
    if (!mix) return value;
    const first = resolve(mix[1], new Set(seen));
    const second = resolve(mix[2], new Set(seen));
    if (!isHex(first) || !isHex(second)) return undefined;
    const ratio = Number(mix[3]) / 100;
    return (
      '#' +
      first
        .slice(1)
        .match(/../g)
        .map((channel, index) =>
          Math.round(
            Number.parseInt(channel, 16) * (1 - ratio) +
              Number.parseInt(second.slice(1).match(/../g)[index], 16) * ratio,
          )
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };
  return new Map([...values.keys()].map((token) => [token, resolve(token)]));
}

/** An opaque hex for a token, composited onto `backdrop` when translucent. */
function opaque(palette, token, backdrop) {
  return composite(palette.get(token), backdrop);
}

/** The violation for one ink on one surface, or null when it reads. */
function inkViolation(palette, { scope, cssLabel, minimum }, inkToken, surfaceToken, surface) {
  const ink = opaque(palette, inkToken, surface);
  if (!isHex(ink) || !isHex(surface)) {
    return `${cssLabel}: ${scope} cannot resolve ${inkToken} on ${surfaceToken}`;
  }
  const ratio = contrastRatio(ink, surface);
  if (ratio < minimum) {
    return `${cssLabel}: ${scope} ${inkToken} on ${surfaceToken} is ${ratio.toFixed(2)}:1; needs ${minimum}:1`;
  }
  return null;
}

function contrastViolations(palette, scope, cssLabel) {
  const panel = palette.get(color('panel'));
  const violations = [];
  for (const { inks, surfaces, minimum, scopes } of CONTRAST_PAIRS) {
    if (!scopes.includes(scope)) continue;
    for (const surfaceToken of surfaces) {
      const surface = opaque(palette, surfaceToken, panel);
      for (const inkToken of inks) {
        const violation = inkViolation(
          palette,
          { scope, cssLabel, minimum },
          inkToken,
          surfaceToken,
          surface,
        );
        if (violation) violations.push(violation);
      }
    }
  }
  return violations;
}

function separationViolations(palette, scope, cssLabel) {
  const panel = palette.get(color('panel'));
  const violations = [];
  for (const { name, pairs, scopes } of SEPARATED_SETS) {
    if (!scopes.includes(scope)) continue;
    for (const [firstToken, secondToken] of pairs) {
      const first = opaque(palette, firstToken, panel);
      const second = opaque(palette, secondToken, panel);
      if (!isHex(first) || !isHex(second)) {
        violations.push(`${cssLabel}: ${scope} cannot resolve ${firstToken} / ${secondToken}`);
        continue;
      }
      const gap = separation(first, second);
      const separable =
        gap.lightness >= MIN_LIGHTNESS_STEP ||
        (gap.deuteranopia >= MIN_SIMULATED_DISTANCE && gap.protanopia >= MIN_SIMULATED_DISTANCE);
      if (!separable) {
        violations.push(
          `${cssLabel}: ${scope} ${name} ${firstToken} / ${secondToken} are too close ` +
            `(ΔL* ${gap.lightness.toFixed(1)}, deuteranopia ΔE ${gap.deuteranopia.toFixed(1)}, ` +
            `protanopia ΔE ${gap.protanopia.toFixed(1)})`,
        );
      }
    }
  }
  return violations;
}

/** Hover, selected and pressed tints step steadily away from their surface. */
function stateLadderViolations(palette, scope, cssLabel) {
  const panel = palette.get(color('panel'));
  const steps = STATE_LADDER.map((token) => opaque(palette, token, panel));
  if (!steps.every(isHex)) return [`${cssLabel}: ${scope} cannot resolve the state tint ladder`];
  const levels = steps.map((step) => lightness(step));
  const darkening = levels[0] > 50;
  const violations = [];
  for (let index = 1; index < levels.length; index += 1) {
    const ordered = darkening
      ? levels[index] < levels[index - 1]
      : levels[index] > levels[index - 1];
    if (!ordered) {
      violations.push(
        `${cssLabel}: ${scope} ${STATE_LADDER[index]} must be ${darkening ? 'darker' : 'lighter'} than ${STATE_LADDER[index - 1]}`,
      );
    }
  }
  return violations;
}

/**
 * The whole matrix for a token stylesheet's text.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function paletteViolations(source, cssLabel = TOKEN_CSS) {
  const violations = [];
  if (
    !new RegExp(escapeRegExp(DARK) + String.raw`\s*\{`).test(
      source.replace(/\/\*[\s\S]*?\*\//g, ''),
    )
  ) {
    violations.push(`${cssLabel}: dark theme token mapping is missing`);
  }
  for (const scope of ALL_SCOPES) {
    const palette = resolvePalette(source, scope);
    violations.push(
      ...contrastViolations(palette, scope, cssLabel),
      ...separationViolations(palette, scope, cssLabel),
      ...stateLadderViolations(palette, scope, cssLabel),
    );
  }
  return violations;
}

export function textContrastViolations(root) {
  const cssPath = join(root, ...TOKEN_CSS.split('/'));
  const cssLabel = relative(root, cssPath).replaceAll('\\', '/');
  return paletteViolations(readFileSync(cssPath, 'utf8'), cssLabel);
}
