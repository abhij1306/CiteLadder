import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { deltaE2000, isHex } from './design-system-color.mjs';
import { lineIndex } from './source-ast.mjs';

/**
 * Colour policy for shipped SVG assets.
 *
 * An inline icon inherits `currentColor`; a brand asset may paint only the
 * token colours it is allowed, resolved from globals.css rather than restated
 * here, so the logo cannot drift from the palette it advertises. The blog's
 * editorial illustrations paint with palette tokens, `var(--color-x, #light)`,
 * so they follow the page's theme when inlined and fall back to the light
 * palette when loaded as an image.
 */

/** Brand assets and the tokens (light theme) their paints must equal. */
const BRAND_ASSETS = new Map([['public/citeladder-logo.svg', ['--color-ink', '--color-accent']]]);

const PAINT_ATTRIBUTE =
  /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*(?:=\s*["']([^"']*)["']|:\s*([^;"'}]+))/g;
const NEUTRAL_PAINT = /^(?:none|currentcolor|transparent|inherit|url\(#[\w-]+\))$/i;

function normalHex(value) {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return value.toLowerCase();
}

const TOKEN_PAINT = /^var\(\s*(--color-[\w-]+)\s*(?:,\s*(#[\da-f]{6})\s*)?\)$/i;

/**
 * The token a paint names, `var(--color-x)` or `var(--color-x, #hex)`, or
 * undefined. The token must resolve in the palette and a fallback must equal
 * its light value, so the file reads the same standalone as inside the themed
 * page.
 */
function paletteToken(value, palette) {
  const match = TOKEN_PAINT.exec(value);
  if (!match) return undefined;
  const light = palette.get(match[1]);
  if (!isHex(light)) return undefined;
  if (match[2] && normalHex(match[2]) !== light.toLowerCase()) return undefined;
  return match[1];
}

/**
 * Findings for one SVG. `palette` maps each token to its resolved light hex:
 * a brand asset may paint only its allowed tokens, as hex or `var()`; any
 * other asset may paint any palette token through `var()`.
 * @public — also imported by the scripts/frontend fixture tests.
 */
export function svgColorFindings(source, label, palette = new Map()) {
  const lineOf = lineIndex(source);
  const brand = BRAND_ASSETS.get(label);
  const allowed = new Map(
    (brand ?? [])
      .map((token) => [palette.get(token), token])
      .filter(([hex]) => isHex(hex))
      .map(([hex, token]) => [hex.toLowerCase(), token]),
  );
  const findings = [];
  for (const match of source.matchAll(PAINT_ATTRIBUTE)) {
    const [, attribute, quoted, styled] = match;
    const value = (quoted ?? styled ?? '').trim();
    if (!value || NEUTRAL_PAINT.test(value)) continue;
    const token = paletteToken(value, palette);
    if (token && (!brand || brand.includes(token))) continue;
    const hex = normalHex(value);
    if (brand && allowed.has(hex)) continue;
    let message = `${attribute} ${value} must be currentColor or none`;
    if (brand && isHex(hex) && allowed.size) {
      const [nearest] = [...allowed].sort(
        ([first], [second]) => deltaE2000(hex, first) - deltaE2000(hex, second),
      );
      message = `${attribute} ${value} is not ${nearest[1]} (${nearest[0]})`;
    } else if (brand && token) {
      message = `${attribute} ${value} is not one of ${brand.join(', ')}`;
    }
    findings.push({ rule: 'svg-color', file: label, line: lineOf(match.index), message });
  }
  return findings;
}

/** A brand token the allowlist names but the palette no longer resolves. */
export function brandTokenViolations(palette) {
  return [...BRAND_ASSETS].flatMap(([label, tokens]) =>
    tokens
      .filter((token) => !isHex(palette.get(token)))
      .map((token) => `${label}: brand token ${token} does not resolve to a hex colour`),
  );
}

function svgPaths(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return svgPaths(path);
    return name.endsWith('.svg') ? [path] : [];
  });
}

/** Every SVG colour finding under public/. */
export function svgColorScan(root, palette) {
  return svgPaths(join(root, 'public')).flatMap((path) =>
    svgColorFindings(
      readFileSync(path, 'utf8'),
      relative(root, path).replaceAll('\\', '/'),
      palette,
    ),
  );
}
