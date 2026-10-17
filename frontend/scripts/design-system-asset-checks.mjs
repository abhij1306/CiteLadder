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
 * editorial illustrations predate the palette: their colours are recorded in
 * the ratchet baseline and may only fall.
 */

/** Brand assets and the tokens (light theme) their paints must equal. */
const BRAND_ASSETS = new Map([
  ['public/citeladder-logo.svg', ['--color-brand-ink', '--color-accent']],
]);

const PAINT_ATTRIBUTE =
  /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*(?:=\s*["']([^"']*)["']|:\s*([^;"'}]+))/g;
const NEUTRAL_PAINT = /^(?:none|currentcolor|transparent|inherit|url\(#[\w-]+\))$/i;

function normalHex(value) {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return value.toLowerCase();
}

/**
 * Findings for one SVG. `palette` maps each brand token to its resolved hex;
 * it is consulted only for files in BRAND_ASSETS.
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
    const hex = normalHex(value);
    if (brand && allowed.has(hex)) continue;
    let message = `${attribute} ${value} must be currentColor or none`;
    if (brand && isHex(hex) && allowed.size) {
      const [nearest] = [...allowed].sort(
        ([first], [second]) => deltaE2000(hex, first) - deltaE2000(hex, second),
      );
      message = `${attribute} ${value} is not ${nearest[1]} (${nearest[0]})`;
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
