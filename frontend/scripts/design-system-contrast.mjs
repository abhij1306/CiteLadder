import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  { name: LIGHT, layers: [LIGHT, APP_LIGHT], kind: 'app' },
  { name: DARK, layers: [DARK, APP_LIGHT, APP_DARK], kind: 'app' },
];

const color = (role) => `--color-${role}`;
const STATUSES = ['positive', 'negative', 'warning', 'info'];
const WEBSITE_GROUNDS = ['paper', 'chrome', 'surface', 'surface-sunken'].map(color);
const APP_FILLS = ['ground', 'panel', 'raised', 'raised-2'].map(color);
const APP_SERIES = ['data-you', 'data-rival-1', 'data-rival-2', 'data-rival-3', 'data-rival-4'];

/**
 * The contrast matrix, the design system's own (Colors): every
 * text pair a token's usage names holds 4.5:1 in both themes; marks, control
 * borders and the focus ring hold 3:1. Each row pairs every ink with every
 * surface. A translucent surface is composited on each ground a row names in
 * `over` (`surface` when it names none), and a translucent ink on the surface
 * beneath it.
 */
const CONTRAST_PAIRS = [
  {
    inks: ['ink', 'ink-secondary', 'ink-muted'].map(color),
    surfaces: WEBSITE_GROUNDS,
    minimum: 4.5,
  },
  {
    inks: ['ink', 'ink-secondary'].map(color),
    surfaces: ['state-hover', 'state-pressed', 'state-selected'].map(color),
    over: WEBSITE_GROUNDS,
    minimum: 4.5,
  },
  {
    inks: [color('ink')],
    surfaces: ['accent', ...STATUSES].map((role) => color(`${role}-soft`)),
    minimum: 4.5,
  },
  {
    inks: [color('ink'), color('ink-secondary')],
    surfaces: ['stage-sky', 'stage-mint', 'stage-lilac', 'stage-peach'].map(color),
    minimum: 4.5,
    only: 'website',
  },
  ...STATUSES.map((status) => ({
    inks: [color(status)],
    surfaces: [color('paper'), color('surface'), color(`${status}-soft`)],
    minimum: 4.5,
  })),
  {
    inks: [color('accent-ink')],
    surfaces: [color('paper'), color('surface'), color('accent-soft')],
    minimum: 4.5,
  },
  { inks: [color('on-ink')], surfaces: [color('ink'), color('ink-hover')], minimum: 4.5 },
  {
    inks: [color('on-primary')],
    surfaces: [color('primary-from'), color('primary-to')],
    minimum: 4.5,
  },
  { inks: [color('ink')], surfaces: [color('button-from'), color('button-to')], minimum: 4.5 },
  { inks: [color('negative')], surfaces: [color('button-from')], minimum: 4.5 },
  { inks: [color('accent'), color('focus')], surfaces: WEBSITE_GROUNDS, minimum: 3 },
  { inks: [color('line-control')], surfaces: WEBSITE_GROUNDS, minimum: 3, only: 'website' },
  {
    inks: ['ink', 'ink-secondary', 'ink-muted'].map(color),
    surfaces: ['site-page', 'site-well'].map(color),
    minimum: 4.5,
    only: 'marketing',
  },
  {
    inks: [color('site-chip-ink')],
    surfaces: [color('site-chip')],
    minimum: 4.5,
    only: 'marketing',
  },
  {
    inks: [color('ink'), color('site-band-ink-secondary')],
    surfaces: ['site-band-from', 'site-band-mid', 'site-band-to'].map(color),
    minimum: 4.5,
    only: 'marketing',
  },
  { inks: [color('site-mark')], surfaces: [color('site-page')], minimum: 3, only: 'marketing' },
  { inks: ['ink', 'ink-2'].map(color), surfaces: APP_FILLS, minimum: 4.5, only: 'app' },
  { inks: [color('focus')], surfaces: APP_FILLS, minimum: 3, only: 'app' },
  {
    inks: ['ink', 'ink-2'].map(color),
    surfaces: ['state-hover', 'state-pressed', 'state-selected'].map(color),
    over: ['ground', 'panel', 'raised'].map(color),
    minimum: 4.5,
    only: 'app',
  },
  {
    inks: ['ink', 'ink-2'].map(color),
    surfaces: ['accent', ...STATUSES].map((role) => color(`${role}-wash`)),
    minimum: 4.5,
    only: 'app',
  },
  ...STATUSES.map((status) => ({
    inks: [color(status)],
    surfaces: [...APP_FILLS, color(`${status}-wash`)],
    minimum: 4.5,
    only: 'app',
  })),
  {
    inks: [color('accent-text')],
    surfaces: [...APP_FILLS, color('accent-wash')],
    minimum: 4.5,
    only: 'app',
  },
  {
    inks: [color('accent'), ...APP_SERIES.map(color), color('data-other')],
    surfaces: APP_FILLS,
    minimum: 3,
    only: 'app',
  },
];

/** @public */
export function contrastRoles() {
  return {
    inks: [...new Set(CONTRAST_PAIRS.flatMap(({ inks }) => inks))],
    surfaces: [...new Set(CONTRAST_PAIRS.flatMap(({ surfaces }) => surfaces))],
  };
}

const channels = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16));
const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value ?? '');
const toHex = (rgb) =>
  '#' + rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');
const toLinear = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
const multiply = (matrix, vector) =>
  matrix.map((row) => row.reduce((sum, weight, index) => sum + weight * vector[index], 0));

const OKLAB_TO_LMS = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_SRGB = [
  [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
  [-1.2684379732850315, 2.6097573492876882, -0.341319376002657],
  [-0.0041960761386756, -0.7034186179359362, 1.7076146940746117],
];

function oklchChannels(lightness, chroma, hue) {
  const radians = (hue * Math.PI) / 180;
  const lab = [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
  const lms = multiply(OKLAB_TO_LMS, lab).map((value) => value ** 3);
  return multiply(LMS_TO_SRGB, lms).map((linear) =>
    Math.round(Math.min(1, Math.max(0, fromLinear(linear))) * 255),
  );
}

const alphaOf = (text) => {
  if (text === undefined) return 1;
  return text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
};

function parseColour(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (isHex(text)) return { rgb: channels(text), alpha: 1 };
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(text);
  if (rgb) return { rgb: [rgb[1], rgb[2], rgb[3]].map(Number), alpha: alphaOf(rgb[4]) };
  const oklch = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(
    text,
  );
  if (!oklch) return undefined;
  const [lightness, chroma, hue] = [oklch[1], oklch[2], oklch[3]].map(Number);
  return { rgb: oklchChannels(lightness / 100, chroma, hue), alpha: alphaOf(oklch[4]) };
}

function formatColour({ rgb, alpha }) {
  if (alpha >= 1) return toHex(rgb);
  return `rgb(${rgb.map(Math.round).join(' ')} / ${Number((alpha * 100).toFixed(4))}%)`;
}

function relativeLuminance(hex) {
  const [red, green, blue] = channels(hex).map((channel) => toLinear(channel / 255));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function composite(value, backdrop) {
  const colour = parseColour(value);
  if (colour?.alpha === 1) return toHex(colour.rgb);
  if (!colour || !isHex(backdrop)) return undefined;
  const base = channels(backdrop);
  return toHex(
    colour.rgb.map((channel, index) => channel * colour.alpha + base[index] * (1 - colour.alpha)),
  );
}

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
    const prelude = clean.slice(cursor, open).split(';').at(-1).trim();
    rules.push({
      selectors: prelude.split(',').map((part) => part.replace(/\s+/g, ' ').trim()),
      body: clean.slice(open + 1, close - 1),
    });
    cursor = close;
  }
  return rules;
}

function customProperties(body) {
  const segments = body.replace(/\{[^{}]*\}/g, ';').split(';');
  return segments.flatMap((segment) => {
    const colon = segment.indexOf(':');
    const token = segment.slice(0, colon).trim();
    const value = segment.slice(colon + 1).trim();
    return colon > 0 && /^--[\w-]+$/.test(token) && value ? [[token, value]] : [];
  });
}

/** @public */
export function paletteDeclarations(source, selector) {
  const rules = topLevelRules(source.replace(/\/\*[\s\S]*?\*\//g, ''));
  const declarations = (scope) =>
    rules
      .filter(({ selectors }) => selectors.includes(scope))
      .flatMap(({ body }) => customProperties(body));
  const layers = (Array.isArray(selector) ? selector : [selector]).filter(
    (layer) => layer !== LIGHT,
  );
  return new Map([
    ...declarations('@theme'),
    ...declarations('@theme inline'),
    ...declarations(LIGHT),
    ...layers.flatMap((layer) => declarations(layer)),
  ]);
}

const RELATIVE = /^oklch\(\s*from\s+var\((--[\w-]+)\)\s+l\s+c\s+h\s*(?:\/\s*([\d.]+)%\s*)?\)$/;

/** @public */
export function resolvePalette(source, selector) {
  const values = paletteDeclarations(source, selector);
  const resolve = (token, seen = new Set()) => {
    if (seen.has(token)) return undefined;
    seen.add(token);
    const value = values.get(token);
    const alias = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
    if (alias) return resolve(alias, seen);
    const relative = RELATIVE.exec(value ?? '');
    if (!relative) {
      const colour = parseColour(value);
      return colour ? formatColour(colour) : value;
    }
    const base = parseColour(resolve(relative[1], seen));
    if (!base) return undefined;
    const alpha = relative[2] === undefined ? base.alpha : Number(relative[2]) / 100;
    return formatColour({ rgb: base.rgb, alpha });
  };
  return new Map([...values.keys()].map((token) => [token, resolve(token)]));
}

function rowViolations(palette, scope, { inks, surfaces, over = [color('surface')], minimum }) {
  return over.flatMap((groundToken) =>
    surfaces.flatMap((surfaceToken) => {
      const surface = composite(palette.get(surfaceToken), palette.get(groundToken));
      const label = over.length > 1 ? `${surfaceToken} over ${groundToken}` : surfaceToken;
      return inks.flatMap((inkToken) => {
        const ink = composite(palette.get(inkToken), surface);
        if (!isHex(ink) || !isHex(surface))
          return [`${TOKEN_CSS}: ${scope} cannot resolve ${inkToken} on ${label}`];
        const ratio = contrastRatio(ink, surface);
        return ratio < minimum
          ? [
              `${TOKEN_CSS}: ${scope} ${inkToken} on ${label} is ${ratio.toFixed(2)}:1; needs ${minimum}:1`,
            ]
          : [];
      });
    }),
  );
}

/** @public */
export function paletteViolations(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const violations = clean.includes(`${DARK} {`)
    ? []
    : [`${TOKEN_CSS}: dark theme token mapping is missing`];
  for (const { name, layers, kind } of SCOPES) {
    const palette = resolvePalette(source, layers);
    const holds = (row) =>
      row.only === undefined ||
      row.only === kind ||
      (row.only === 'website' && kind === 'marketing');
    violations.push(
      ...CONTRAST_PAIRS.filter(holds).flatMap((row) => rowViolations(palette, name, row)),
    );
  }
  return violations;
}

export function textContrastViolations(root) {
  return paletteViolations(readFileSync(join(root, ...TOKEN_CSS.split('/')), 'utf8'));
}
