import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { composite, contrastRatio, isHex, separation } from './design-system-color.mjs';

const TOKEN_CSS = 'apps/app/src/globals.css';
const LIGHT = ':root';
const DARK = ":root[data-theme='dark']";
const APP_LIGHT = ':root:not([data-public-surface])';
const APP_DARK = ":root[data-theme='dark']:not([data-public-surface])";
/**
 * Each palette the app renders, as the rule blocks that build it in cascade
 * order: the system's light or dark tokens, then the app's rebinds on top
 * (D58, D59). The app's light block follows the system dark at the same
 * specificity, so it sits under the app's dark block in the app's dark. A
 * stylesheet without the app blocks resolves to the system's two themes.
 */
const SCOPES = [
  { name: LIGHT, layers: [LIGHT, APP_LIGHT] },
  { name: DARK, layers: [DARK, APP_LIGHT, APP_DARK] },
];

const color = (role) => `--color-${role}`;
const STATUSES = ['positive', 'negative', 'warning', 'info'];
const SOFTS = ['accent', ...STATUSES].map((role) => color(`${role}-soft`));
const GROUNDS = ['paper', 'sidebar', 'surface', 'surface-sunken'].map(color);
const SERIES = ['data-1', 'data-2', 'data-3'].map(color);

/**
 * The contrast matrix, the design system's own (Colors): every
 * text pair a token's usage names holds 4.5:1 in both themes; marks, control
 * borders and the focus ring hold 3:1. Each row pairs every ink with every
 * surface. A translucent surface is composited on each ground a row names in
 * `over` (`surface` when it names none), and a translucent ink on the surface
 * beneath it.
 */
const CONTRAST_PAIRS = [
  // The three inks on the page, the sidebar, the card and the inset.
  { inks: ['ink', 'ink-secondary', 'ink-muted'].map(color), surfaces: GROUNDS, minimum: 4.5 },
  // A hovered, pressed or selected row keeps its text readable (D51). The
  // states are overlays, so each is checked over every ground it can tint.
  {
    inks: ['ink', 'ink-secondary'].map(color),
    surfaces: ['state-hover', 'state-pressed', 'state-selected'].map(color),
    over: GROUNDS,
    minimum: 4.5,
  },
  // Callout and badge bodies are ink on every tint.
  { inks: [color('ink')], surfaces: SOFTS, minimum: 4.5 },
  // A status ink on paper, surface and its own tint.
  ...STATUSES.map((status) => ({
    inks: [color(status)],
    surfaces: [color('paper'), color('surface'), color(`${status}-soft`)],
    minimum: 4.5,
  })),
  // Accent as text: links in reading copy, on paper, surface and accent-soft.
  {
    inks: [color('accent-ink')],
    surfaces: [color('paper'), color('surface'), color('accent-soft')],
    minimum: 4.5,
  },
  // Labels on fills: the primary button (and its hover) and the own-brand number.
  { inks: [color('on-ink')], surfaces: [color('ink'), color('ink-hover')], minimum: 4.5 },
  { inks: [color('on-accent')], surfaces: [color('accent')], minimum: 4.5 },
  // Marks: Flare, the named chart series, control marks and the focus ring.
  {
    inks: [color('accent'), ...SERIES, color('line-control'), color('focus')],
    surfaces: GROUNDS,
    minimum: 3,
  },
];

/**
 * Every ink and every surface token the contrast matrix reads, so a fixture
 * can bind a complete palette without restating the matrix row by row.
 * @public — imported by the scripts/ fixture tests.
 */
export function contrastRoles() {
  return {
    inks: [...new Set(CONTRAST_PAIRS.flatMap(({ inks }) => inks))],
    surfaces: [...new Set(CONTRAST_PAIRS.flatMap(({ surfaces }) => surfaces))],
  };
}

/**
 * Marks that must stay distinguishable without full colour vision: by
 * lightness alone, or by hue under both red–green deficiencies. Status hues
 * always ship beside an arrow, icon or word too.
 */
const MIN_LIGHTNESS_STEP = 15;
const MIN_SIMULATED_DISTANCE = 10;
const pairsOf = (tokens) =>
  tokens.flatMap((first, index) => tokens.slice(index + 1).map((second) => [first, second]));
const SEPARATED_SETS = [
  { name: 'positive and negative', pairs: [[color('positive'), color('negative')]] },
  { name: 'named chart series', pairs: pairsOf(SERIES) },
];

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
  const segments = body.replace(/\{[^{}]*\}/g, ';').split(';');
  return segments.flatMap((segment) => {
    const colon = segment.indexOf(':');
    const token = segment.slice(0, colon).trim();
    const value = segment.slice(colon + 1).trim();
    return colon > 0 && /^--[\w-]+$/.test(token) && value ? [[token, value]] : [];
  });
}

/**
 * The raw declared value of every token a scope sees, before alias
 * resolution: `@theme` and `:root` for light, then each rebinding block on
 * top in order. `selector` is one block's selector or the list of them.
 */
export function paletteDeclarations(source, selector) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = topLevelRules(clean);
  const declarations = (scope) =>
    rules
      .filter(({ selectors }) => selectors.includes(scope))
      .flatMap(({ body }) => customProperties(body));
  const layers = (Array.isArray(selector) ? selector : [selector]).filter(
    (layer) => layer !== LIGHT,
  );
  return new Map([
    ...declarations('@theme'),
    ...declarations(LIGHT),
    ...layers.flatMap((layer) => declarations(layer)),
  ]);
}

/**
 * An opaque `rgb(r g b)` as `#rrggbb`. A translucent `rgb(r g b / a%)` stays
 * as written: `composite` lays it on the surface beneath it.
 */
function hexOf(value) {
  if (isHex(value)) return value.toLowerCase();
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/.exec(value ?? '');
  if (!rgb) return value;
  const channels = [rgb[1], rgb[2], rgb[3]].map((channel) =>
    Number(channel).toString(16).padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

/** Resolve `var()` aliases for every token a scope sees. */
export function resolvePalette(source, selector) {
  const values = paletteDeclarations(source, selector);
  const resolve = (token, seen = new Set()) => {
    if (seen.has(token)) return undefined;
    seen.add(token);
    const value = values.get(token);
    const alias = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
    return alias ? resolve(alias, seen) : hexOf(value);
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

/** One contrast row's violations: each ink on each surface, over each of the row's grounds. */
function rowViolations(palette, { scope, cssLabel }, row) {
  const { inks, surfaces, over = [color('surface')], minimum } = row;
  return over.flatMap((groundToken) => {
    const ground = palette.get(groundToken);
    return surfaces.flatMap((surfaceToken) => {
      const surface = opaque(palette, surfaceToken, ground);
      // A row with several grounds names the one a failure sits on.
      const label = over.length > 1 ? `${surfaceToken} over ${groundToken}` : surfaceToken;
      return inks
        .map((inkToken) =>
          inkViolation(palette, { scope, cssLabel, minimum }, inkToken, label, surface),
        )
        .filter((violation) => violation !== null);
    });
  });
}

function contrastViolations(palette, { name: scope }, cssLabel) {
  return CONTRAST_PAIRS.flatMap((row) => rowViolations(palette, { scope, cssLabel }, row));
}

function separationViolations(palette, scope, cssLabel) {
  const base = palette.get(color('surface'));
  const violations = [];
  for (const { name, pairs } of SEPARATED_SETS) {
    for (const [firstToken, secondToken] of pairs) {
      const first = opaque(palette, firstToken, base);
      const second = opaque(palette, secondToken, base);
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

/**
 * The whole matrix for a token stylesheet's text, in both themes.
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
  for (const scope of SCOPES) {
    const palette = resolvePalette(source, scope.layers);
    violations.push(
      ...contrastViolations(palette, scope, cssLabel),
      ...separationViolations(palette, scope.name, cssLabel),
    );
  }
  return violations;
}

export function textContrastViolations(root) {
  const cssPath = join(root, ...TOKEN_CSS.split('/'));
  const cssLabel = relative(root, cssPath).replaceAll('\\', '/');
  return paletteViolations(readFileSync(cssPath, 'utf8'), cssLabel);
}
