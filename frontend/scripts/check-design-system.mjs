import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import {
  appSourceViolations,
  editorialTypographyViolations,
  cardHeaderLayoutViolations,
  nestedCardViolations,
  directRadixImportViolations,
  productContractViolations,
  productControlViolations,
  productUiSourceViolations,
  standalonePlaceholderViolations,
  textContrastViolations,
  rawRadiusViolations,
  motionRoleViolations,
  focusRoleViolations,
  shadowRoleViolations,
  radiusRoleAdvisories,
  densityRoleViolations,
  styleAssertionViolations,
  textRoleBackgroundViolations,
  tsxGeometryFindings,
  featureLayeringViolations,
  jsxClassData,
} from './design-system-source-checks.mjs';
import { tokenAuditViolations } from './audit-design-tokens.mjs';
import {
  accentFillClassFindings,
  accentHeadingFindings,
  displayFaceClassFindings,
  isWebsiteSource,
  stylesheetContractFindings,
  tokenContractViolations,
  websiteTypeCeilingClassFindings,
} from './design-system-contract.mjs';
import { brandTokenViolations, svgColorScan } from './design-system-asset-checks.mjs';
import { reviewScriptFindings, reviewStylesheetFindings } from './design-system-review-checks.mjs';
import { resolvePalette } from './design-system-contrast.mjs';
import { cssPolicyScan } from './design-system-css-checks.mjs';
import { headingPunctuationViolations } from './design-system-copy-checks.mjs';
import { ratchetVerdict, readBaseline, writeBaseline } from './design-system-ratchet.mjs';
import { typeDisciplineFindings } from './type-discipline-checks.mjs';

const root = resolve(import.meta.dirname, '..');
const tokenOwner = join(root, 'apps', 'app', 'src', 'globals.css');
const sourceExtensions = new Set(['.css', '.ts', '.tsx', '.js', '.mjs']);
const ignored = new Set([
  'node_modules',
  'build',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
]);
const baselinePath = join(root, 'scripts', 'design-system-baseline.json');
const typeBaselinePath = join(root, 'scripts', 'type-discipline-baseline.json');
const violations = [];
const advisories = [];
// Ratcheted findings: counted per file and rule against the baseline.
const findings = [];
// Type-discipline findings, ratcheted against their own baseline. They read
// the same parsed module, so they ride this walk rather than a second one.
const typeFindings = [];
const typeSource = (label) =>
  /^(?:apps|components|lib|packages|services)\//.test(label) &&
  /\.tsx?$/.test(label) &&
  !/\.(?:test|spec)\.tsx?$|\.d\.ts$/.test(label) &&
  !/\/(?:test|e2e|generated)\//.test(label);
// Script sources, for the app's Tailwind @source coverage.
const scriptSources = [];

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignored.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const tokenCss = readFileSync(tokenOwner, 'utf8');
const ownsStyles = (label) => /^(?:apps|components|packages)\//.test(label);

for (const path of files(root)) {
  const extension = extname(path);
  if (!sourceExtensions.has(extension)) continue;
  const source = readFileSync(path, 'utf8');
  const label = relative(root, path).replaceAll('\\', '/');
  if (/^(?:apps|components|lib)\//.test(label) && /\.tsx?$/.test(label)) {
    violations.push(...headingPunctuationViolations(source, label));
  }
  // Cal Sans, Flare and the type ceiling, in every stylesheet.
  if (ownsStyles(label) && extension === '.css') {
    violations.push(
      ...stylesheetContractFindings(source, label, tokenCss),
      ...reviewStylesheetFindings(source, label),
    );
  }
  if (/^(?:apps|components|lib)\//.test(label) && /\.tsx?$/.test(label)) {
    violations.push(
      ...reviewScriptFindings(source, label),
      ...displayFaceClassFindings(source, label),
      ...accentFillClassFindings(source, label),
      ...(label.endsWith('.tsx') ? accentHeadingFindings(jsxClassData(source, label), label) : []),
      ...(isWebsiteSource(label) ? websiteTypeCeilingClassFindings(source, label) : []),
    );
  }
  if (/\.tsx?$/.test(label) && !/\.test\.tsx?$/.test(label)) scriptSources.push({ label, source });
  const legacyIdentifiers = [
    ['Search', 'ify'].join(''),
    ['search', 'ify'].join(''),
    ['--', 'ds-'].join(''),
    ['--', 'mkt-'].join(''),
    ['Theme', 'Toggle'].join(''),
    ['Public', ' Sans'].join(''),
    ['Public', '_Sans'].join(''),
    ['font', '-public-sans'].join(''),
    // The design before the 2026-11 system: green palette, grain ground,
    // dot lattice, tinted fields, flat-surface elevation, the old faces.
    ['ground', '-grain'].join(''),
    ['--', 'lattice'].join(''),
    ['--', 'grain'].join(''),
    ['field', '-mint'].join(''),
    ['field', '-lime'].join(''),
    ['--', 'elevation-'].join(''),
    ['--', 'tag-'].join(''),
    ['font', '-numeric'].join(''),
    ['TASA', ' Orbiter'].join(''),
    ['Swit', 'zer'].join(''),
    ['JetBrains', ' Mono'].join(''),
    // Decision D8 (2026-11-05): a score is a ring or its number, never a
    // segmented bar.
    ['Score', 'Bar'].join(''),
    ['score', '-bar'].join(''),
    // Decision D11 (2026-11-05): the app sidebar carries no logo.
    ['SIDEBAR', '_LOGO_CLASSES'].join(''),
  ];
  for (const legacy of legacyIdentifiers) {
    // A whole identifier: the retired text face is not the country it prefixes.
    const escaped = legacy.replaceAll(/[.*+?^$(){}|[\]\\]/g, String.raw`\$&`);
    if (new RegExp(`${escaped}(?![a-z])`).test(source)) {
      violations.push(`${label}: legacy identifier ${legacy}`);
    }
  }
  if (
    path !== tokenOwner &&
    path !== import.meta.filename &&
    /(?<![\w-])#[0-9a-f]{3,8}(?![\w-])/i.test(source)
  ) {
    violations.push(`${label}: raw color outside apps/app/src/globals.css`);
  }
  if (
    path !== tokenOwner &&
    path !== import.meta.filename &&
    /@theme\b(?:\s+(?:inline|static|reference|default))*\s*\{/.test(source)
  ) {
    violations.push(`${label}: @theme outside apps/app/src/globals.css`);
  }
  violations.push(
    ...directRadixImportViolations(source, label),
    ...styleAssertionViolations(source, label),
  );
  const ownsWebsiteEditorialCopy =
    !label.includes('.test.') && label.startsWith('components/marketing/');
  // Sign-in and onboarding are product UI: they compose the system's
  // AuthShell, AuthCard and OnboardingStep (components/ui).
  const ownsProductUi =
    !label.includes('.test.') &&
    !label.startsWith('components/marketing/') &&
    !label.startsWith('lib/marketing-content/') &&
    (label.startsWith('apps/app/src/') ||
      label.startsWith('components/') ||
      label.startsWith('lib/'));
  // Applies to every source file, not just product UI: the ESLint rule this
  // replaced was repository-wide, and a text-ink background is wrong on a
  // flow surface too.
  violations.push(
    ...textRoleBackgroundViolations(source, label),
    ...rawRadiusViolations(source, label),
    ...editorialTypographyViolations(source, label, ownsWebsiteEditorialCopy),
    ...standalonePlaceholderViolations(source, label, ownsProductUi),
    ...productUiSourceViolations(source, label, ownsProductUi),
    ...motionRoleViolations(source, label, ownsProductUi),
    ...focusRoleViolations(source, label, ownsProductUi),
    ...shadowRoleViolations(source, label, ownsProductUi),
    ...densityRoleViolations(source, label, ownsProductUi),
    ...nestedCardViolations(source, label, ownsProductUi),
    ...cardHeaderLayoutViolations(source, label, ownsProductUi),
    ...productControlViolations(source, label, ownsProductUi),
    ...featureLayeringViolations(source, label),
  );
  advisories.push(...radiusRoleAdvisories(source, label, ownsProductUi));
  if (/^(?:apps|components|lib)\//.test(label))
    findings.push(...tsxGeometryFindings(source, label));
  if (typeSource(label)) typeFindings.push(...typeDisciplineFindings(source, label));
}

const lightPalette = resolvePalette(tokenCss, ':root');
findings.push(...cssPolicyScan(root), ...svgColorScan(root, lightPalette));
for (const [path, ratcheted] of [
  [baselinePath, findings],
  [typeBaselinePath, typeFindings],
]) {
  if (process.argv.includes('--write-baseline')) {
    writeBaseline(path, ratcheted);
    console.log(`Wrote ${relative(root, path)} (${ratcheted.length} findings).`);
  }
  const ratchet = ratchetVerdict(ratcheted, existsSync(path) ? readBaseline(path) : { files: {} });
  violations.push(...ratchet.violations);
  if (ratchet.lowered.length) {
    advisories.push(
      ...ratchet.lowered,
      'Debt fell: run node scripts/check-design-system.mjs --write-baseline to lower the baseline.',
    );
  }
}

violations.push(
  ...brandTokenViolations(lightPalette),
  ...tokenContractViolations(root),
  ...tokenAuditViolations(root),
  ...textContrastViolations(root),
  ...productContractViolations(root),
  ...appSourceViolations(
    readFileSync(join(root, 'apps', 'app', 'src', 'app.css'), 'utf8'),
    scriptSources,
  ),
);

// Font files are never committed: some typefaces the design names are licensed
// for self-hosting, not redistribution. Git's index, not the disk, is what gets
// published.
const GIT_EXECUTABLE =
  process.platform === 'win32' ? String.raw`C:\Program Files\Git\cmd\git.exe` : '/usr/bin/git';
const trackedFiles = execFileSync(GIT_EXECUTABLE, ['-C', root, 'ls-files', '--', ':(top)'], {
  encoding: 'utf8',
}).split('\n');
for (const path of trackedFiles) {
  if (/\.(?:woff2?|ttf|otf)$/i.test(path)) {
    violations.push(`${path}: font files are never committed`);
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
if (advisories.length) console.warn(advisories.join('\n'));
console.log('CiteLadder design-system policy passed.');
