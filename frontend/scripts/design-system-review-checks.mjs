import postcss from 'postcss';

import { lineIndex, parseSource, stringFragments } from './source-ast.mjs';

/**
 * The owner's 2026-11-05 review of the shipped app and docs (decisions D5–D9
 * in docs/plans/design-system-rollout.md), kept from coming back:
 *
 * - D5: fields, composers and cards wear the soft `line` edge (the xs ring a
 *   secondary Button wears), never the dark `line-control` hairline, which
 *   stays for marks too small to read without it;
 * - D6: Geist is never set above 500;
 * - D7: in the app Cal Sans is the page title's alone;
 * - D9: a row of equal figures is one row from 981px, never 2 × 2 or 2 + 1;
 * - D10: corners are only slightly rounded everywhere: nothing above 8px,
 *   and radius-full only for avatars, status dots, switch tracks and pills;
 * - D11: the app is compact (its density block holds the owner's values, the
 *   page title is 24/32) and its sidebar carries no logo;
 * - D15: a metric's number (`stat`) is 28px;
 * - D28: on the website Cal Sans is the H1 and one heading per section.
 *
 * D12 (the sticky top bar) is held by the geometry census, D14 by the
 * ranked list's type (it has no figure slot).
 *
 * D8 (a score is a ring or its number, never segmented bars) retires the bar
 * component outright; check-design-system.mjs lists its name as legacy.
 */

const TOKEN_CSS = 'apps/app/src/globals.css';

/** The website keeps its own type and edges; these decisions are the app's and the docs'. */
const isMarketing = (label) => /^(?:apps\/marketing\/|components\/marketing\/)/.test(label);
const inScope = (label) =>
  /^(?:apps\/app\/|apps\/docs\/|components\/|lib\/)/.test(label) && !isMarketing(label);
const isAppSource = (label) =>
  /^(?:apps\/app\/|components\/|lib\/)/.test(label) && !isMarketing(label);
const isScript = (label) => /\.(?:tsx|ts)$/.test(label) && !/\.(?:test|spec)\./.test(label);

/** Class-string findings, one per string fragment that matches `pattern`. */
function classFindings(source, label, pattern, message) {
  const lineOf = lineIndex(source);
  return stringFragments(parseSource(source, label))
    .filter(({ text }) => pattern.test(text))
    .map(({ start }) => `${label}:${lineOf(start)}: ${message}`);
}

// ── D6: Geist never above 500 ───────────────────────────────────────────────

const HEAVY_CLASS =
  /(?<![\w-])(?:[\w-]+:)*font-(?:semibold|bold|extrabold|black|\[(?:[6-9]00|bold|bolder)\])(?![\w-])/;
const HEAVY_VALUE = /^(?:[6-9]00|bold|bolder)$/;
const WEIGHT_MESSAGE = 'Geist is never set above 500 (decision D6); use a role or font-medium';

/** Every surface, the website included: the faces load only 400–500. */
function weightClassFindings(source, label) {
  if (!isScript(label)) return [];
  return classFindings(source, label, HEAVY_CLASS, WEIGHT_MESSAGE);
}

function weightCssFindings(css, label) {
  const findings = [];
  postcss.parse(css).walkDecls(/^(?:font-weight|--[\w-]+--font-weight)$/, (decl) => {
    if (HEAVY_VALUE.test(decl.value.trim()))
      findings.push(`${label}:${decl.source?.start?.line ?? 0}: ${WEIGHT_MESSAGE}`);
  });
  return findings;
}

// ── D5: soft edges on fields, composers and cards ───────────────────────────

/**
 * Marks that are not borders and need the 3:1 grey to read at all: the
 * switch's off track, the pending step ring, chart rules, crosshairs and
 * event markers, the ink link underline and the neutral data swatch. Every
 * edge, the checkbox and radio boxes and the dashed create tile included,
 * is `line` or `line-strong`.
 */
const LINE_CONTROL_OWNERS = new Set([
  'components/ui/switch.tsx',
  'components/ui/step-list.tsx',
  'components/ui/chart.tsx',
  'components/ui/trend-chart.tsx',
  'components/performance/performance-plot.tsx',
  'components/ui/text-link.tsx',
  'components/ui/data-tone.ts',
]);
const LINE_CONTROL_CLASS = /(?<![\w-])(?:[\w-]+:)*[a-z]+-line-control(?![\w-])/;
const EDGE_MESSAGE =
  'line-control is for marks that are not borders; an edge is line or line-strong with shadow-edge (decision D5)';

function edgeClassFindings(source, label) {
  if (!inScope(label) || !isScript(label) || LINE_CONTROL_OWNERS.has(label)) return [];
  return classFindings(source, label, LINE_CONTROL_CLASS, EDGE_MESSAGE);
}

function edgeCssFindings(css, label) {
  const findings = [];
  postcss.parse(css).walkDecls((decl) => {
    if (/var\(--color-line-control\)/.test(decl.value))
      findings.push(`${label}:${decl.source?.start?.line ?? 0}: ${EDGE_MESSAGE}`);
  });
  return findings;
}

// ── D7: Cal Sans in the app is the page title's ─────────────────────────────

const DISPLAY_CLASS = /(?:^|\s)(?:[\w-]+:)*font-display(?=\s|$)/;
const DISPLAY_MESSAGE =
  'in the app Cal Sans is the page title alone (type-page-title, decision D7); use a Geist role';

function displayScopeClassFindings(source, label) {
  if (!isAppSource(label) || !isScript(label)) return [];
  return classFindings(source, label, DISPLAY_CLASS, DISPLAY_MESSAGE);
}

/** The app's roles in globals.css: only `.type-page-title` may set Cal Sans. */
function displayScopeCssFindings(css, label) {
  if (label !== TOKEN_CSS) return [];
  const findings = [];
  postcss.parse(css).walkDecls('font-family', (decl) => {
    const selector = decl.parent?.selector ?? '';
    const appRole = /(?:^|[\s,])\.(?:type|prose)-/.test(selector);
    if (
      appRole &&
      selector.trim() !== '.type-page-title' &&
      /var\(--font-display\)/.test(decl.value)
    )
      findings.push(`${label}:${decl.source?.start?.line ?? 0}: ${DISPLAY_MESSAGE}`);
  });
  return findings;
}

// ── D28: on the website Cal Sans is the H1 and one heading per section ──────

/**
 * The website's styles and the long-form components it shares with the docs.
 * The product screens are pictures of the app and follow its rules instead.
 */
const isWebsiteType = (label) =>
  /^(?:apps\/marketing\/src\/|components\/marketing\/|components\/content\/)/.test(label) &&
  !/^(?:apps\/marketing\/src\/screens\.css$|components\/marketing\/screens\/)/.test(label);

/** The headings that may set Cal Sans: hero, article, section, CTA, index group, prose h2. */
const WEBSITE_HEADING =
  /^\.cl-(?:lhero|phero|ahead|shead|cta|sources|cpage-index)-title$|^\.cl-prose h2:not\(\[class\]\)$/;
/** A feature split that is its section's only heading. */
const LONE_SPLIT_TITLE =
  '.cl-page-section:not(:has(.cl-shead-title, .cl-split ~ .cl-split)) .cl-split-title';
const WEBSITE_DISPLAY_MESSAGE =
  'on the website Cal Sans is the H1 and one section heading (decision D28); set this in Geist';

function websiteDisplayCssFindings(css, label) {
  if (!isWebsiteType(label)) return [];
  const findings = [];
  postcss.parse(css).walkDecls('font-family', (decl) => {
    if (!/var\(--font-display\)/.test(decl.value)) return;
    const selectors = decl.parent?.selectors ?? [''];
    const allowed = selectors.every(
      (selector) => WEBSITE_HEADING.test(selector) || selector === LONE_SPLIT_TITLE,
    );
    if (!allowed)
      findings.push(`${label}:${decl.source?.start?.line ?? 0}: ${WEBSITE_DISPLAY_MESSAGE}`);
  });
  return findings;
}

function websiteDisplayClassFindings(source, label) {
  if (!isWebsiteType(label) || !isScript(label)) return [];
  return classFindings(source, label, DISPLAY_CLASS, WEBSITE_DISPLAY_MESSAGE);
}

// ── D9: a row of figures is one row ─────────────────────────────────────────

const COLUMNS_AT = (prefix) => new RegExp(String.raw`(?<![\w-])${prefix}:grid-cols-(\d+)(?![\w-])`);
const DESKTOP_COLUMNS = COLUMNS_AT('desktop');
const SHELL_COLUMNS = COLUMNS_AT('shell');
const ROW_MESSAGE =
  "a row of equal items holds its count from 981px (decision D9), never 2 × 2 or 2 + 1 at the owner's 982px";

/** A grid that adds columns between the desktop and shell breakpoints wraps at 982px. */
function metricRowClassFindings(source, label) {
  if (!isAppSource(label) || !isScript(label)) return [];
  const lineOf = lineIndex(source);
  return stringFragments(parseSource(source, label)).flatMap(({ text, start }) => {
    const desktop = DESKTOP_COLUMNS.exec(text)?.[1];
    const shell = SHELL_COLUMNS.exec(text)?.[1];
    return desktop && shell && Number(shell) > Number(desktop)
      ? [`${label}:${lineOf(start)}: ${ROW_MESSAGE}`]
      : [];
  });
}

// ── D10: only slightly rounded, system-wide ─────────────────────────────────

/** The round things: avatars, status dots, switch tracks and count pills. */
const FULL_RADIUS_OWNERS = new Set([
  'components/ui/avatar.tsx',
  'components/ui/badge.tsx',
  'components/ui/citation.tsx',
  'components/ui/icon.tsx',
  'components/ui/radio-group.tsx',
  'components/ui/step-list.tsx',
  'components/ui/switch.tsx',
]);
const FULL_RADIUS_SELECTORS =
  /(?:^|[\s,])\.(?:activity-dot|cm-switch|cl-ahead-avatar|cl-author-avatar)\b/;
const FULL_CLASS = /(?<![\w-])(?:[\w-]+:)*rounded(?:-[a-z]{1,2})?-full(?![\w-])/;
const FULL_MESSAGE =
  'radius-full is for avatars, status dots, switch tracks and count pills only (decision D10)';
const LITERAL_MESSAGE = 'no corner is rounder than 8px (decision D10); use a radius token';
const MAX_RADIUS_PX = 8;

function fullRadiusClassFindings(source, label) {
  if (!isScript(label) || FULL_RADIUS_OWNERS.has(label)) return [];
  return classFindings(source, label, FULL_CLASS, FULL_MESSAGE);
}

/** A length rounder than 8px: `12px`, `1rem`, `50%`, `9999px`. */
const PX_PER_UNIT = { px: 1, rem: 16, em: 16, '%': Infinity };

function tooRound(value) {
  return [...value.matchAll(/(\d+(?:\.\d+)?|\.\d+)(px|rem|em|%)/g)].some(
    ([, n, unit]) => Number(n) > 0 && Number(n) * PX_PER_UNIT[unit] > MAX_RADIUS_PX,
  );
}

function radiusCssFindings(css, label) {
  const findings = [];
  postcss.parse(css).walkDecls(/^border(?:-[a-z]+)*-radius$/, (decl) => {
    const line = decl.source?.start?.line ?? 0;
    const selector = decl.parent?.selector ?? '';
    if (/var\(--radius-full\)/.test(decl.value) && !FULL_RADIUS_SELECTORS.test(selector))
      findings.push(`${label}:${line}: ${FULL_MESSAGE}`);
    else if (tooRound(decl.value.replace(/var\([^)]*\)/g, '')))
      findings.push(`${label}:${line}: ${LITERAL_MESSAGE}`);
  });
  return findings;
}

// ── D11: the app is compact and technical ───────────────────────────────────

/** The app's density block in globals.css and the values the owner set. */
const APP_DENSITY_SELECTOR = ':root';
/** Controls (32) and `row-app` (40) are system tokens the contract checks. */
const APP_DENSITY = {
  '--page-section-gap': '16px',
  '--workspace-gap': '12px',
  '--card-padding': '16px',
  '--modal-padding': '16px',
  '--table-row-height': 'var(--row-app)',
};
const DENSITY_MESSAGE = 'the app is compact (decision D11)';

/** The page title is 24/32 (`display-sm`). */
const PAGE_TITLE_SIZE = 'var(--text-display-sm)';

/** A metric's number is 28px (decision D15), wherever the token sheet sets it last. */
const STAT_SIZE = '28px';

/** Runs on the token sheet itself (the one with `@theme`), not on a fragment of it. */
function densityCssFindings(css, label) {
  if (label !== TOKEN_CSS || !/@theme\b/.test(css)) return [];
  const found = new Map();
  const titleSizes = [];
  const statSizes = [];
  const root = postcss.parse(css);
  root.walkDecls('--text-stat', (decl) => statSizes.push(decl.value.trim()));
  root.walkRules((rule) => {
    if (rule.selector === '.type-page-title')
      rule.walkDecls('font-size', (decl) => titleSizes.push(decl.value.trim()));
    if (rule.selector !== APP_DENSITY_SELECTOR || rule.parent?.type !== 'root') return;
    rule.walkDecls((decl) => found.set(decl.prop, decl.value.trim()));
  });
  const statFindings =
    statSizes.at(-1) === STAT_SIZE
      ? []
      : [
          `${label}: a metric's number is ${STAT_SIZE} (decision D15): set --text-stat: ${STAT_SIZE}`,
        ];
  const titleSize = titleSizes.at(-1);
  const findings = Object.entries(APP_DENSITY)
    .filter(([prop, value]) => found.get(prop) !== value)
    .map(
      ([prop, value]) =>
        `${label}: ${DENSITY_MESSAGE}: ${APP_DENSITY_SELECTOR} must set ${prop}: ${value}`,
    );
  if (titleSize !== PAGE_TITLE_SIZE)
    findings.push(`${label}: ${DENSITY_MESSAGE}: .type-page-title is ${PAGE_TITLE_SIZE}`);
  return [...findings, ...statFindings];
}

/** The sidebar carries no logo; the project switcher is its first row. */
const SIDEBAR_SOURCES = new Set(['components/layout/app-shell.tsx', 'components/ui/app-shell.tsx']);

function sidebarLogoFindings(source, label) {
  if (!SIDEBAR_SOURCES.has(label) || !/\bLogoMark\b/.test(source)) return [];
  return [`${label}: the app sidebar carries no logo (decision D11)`];
}

/** Every stylesheet rule above, for one stylesheet or Astro `<style>` block. */
export function reviewStylesheetFindings(css, label) {
  const systemWide = [
    ...weightCssFindings(css, label),
    ...radiusCssFindings(css, label),
    ...densityCssFindings(css, label),
    ...websiteDisplayCssFindings(css, label),
  ];
  if (!inScope(label)) return systemWide;
  return [...edgeCssFindings(css, label), ...displayScopeCssFindings(css, label), ...systemWide];
}

/** Every class-string rule above, for one script. */
export function reviewScriptFindings(source, label) {
  return [
    ...weightClassFindings(source, label),
    ...edgeClassFindings(source, label),
    ...displayScopeClassFindings(source, label),
    ...websiteDisplayClassFindings(source, label),
    ...metricRowClassFindings(source, label),
    ...fullRadiusClassFindings(source, label),
    ...sidebarLogoFindings(source, label),
  ];
}
