import fs from 'node:fs';
import path from 'node:path';
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { unsupported } from './browser-support-data.mjs';

const ACKNOWLEDGED_ENHANCEMENTS = {
  'text-wrap: pretty': 'Paragraphs wrap greedily.',
  'scrollbar-color': 'Scrollbars keep the platform colours.',
  'scrollbar-width': 'Scrollbars keep the platform width.',
  'scrollbar-gutter': 'The page does not reserve a scrollbar track.',
  '::-webkit-scrollbar': 'Firefox styles scrollbars through scrollbar-color instead.',
  '::-webkit-scrollbar-track': 'Firefox styles scrollbars through scrollbar-color instead.',
  '::-webkit-scrollbar-thumb': 'Firefox styles scrollbars through scrollbar-color instead.',
  'text-size-adjust': 'The browser keeps its own text inflation on phones.',
  'box-decoration-break': 'A highlight broken across lines loses its end padding.',
  'forced-color-adjust': 'Browsers without a forced colours mode never apply it.',
  '::selection': 'iOS Safari keeps its own selection colour.',
  'cursor: pointer': 'Touch screens have no pointer.',
  'cursor: not-allowed': 'Touch screens have no pointer.',
  'cursor: default': 'Touch screens have no pointer.',
  '@view-transition': 'Website and docs pages change without the cross-fade.',
  'view-transition-name':
    'Without view transitions the top bar has no cross-fade to hold still in.',
  '::view-transition-old':
    'Without view transitions the top bar has no cross-fade to hold still in.',
  '::view-transition-new':
    'Without view transitions the top bar has no cross-fade to hold still in.',
};

const STYLE_ROOTS = ['apps', 'components', 'lib', 'packages'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.astro', 'public']);

const FUNCTIONS = new Map();
for (const [name, feature] of Object.entries(bcd.css.types)) FUNCTIONS.set(name, feature);
for (const type of Object.values(bcd.css.types)) {
  for (const [name, feature] of Object.entries(type)) {
    if (name !== '__compat' && !FUNCTIONS.has(name)) FUNCTIONS.set(name, feature);
  }
}

function guardedBySupports(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'supports') return true;
  }
  return false;
}

function hasFallback(declaration) {
  const siblings = declaration.parent?.nodes ?? [];
  const property = declaration.prop.replace(/^-[a-z]+-/, '');
  return siblings
    .slice(0, siblings.indexOf(declaration))
    .some((node) => node.type === 'decl' && node.prop.replace(/^-[a-z]+-/, '') === property);
}

function declarationFeatures(declaration) {
  const property = bcd.css.properties[declaration.prop];
  if (property && !property.__compat) return [];
  const features = [[declaration.prop, property]];
  valueParser(declaration.value).walk((token) => {
    if (token.type === 'function' && token.value) {
      features.push([`${token.value}()`, FUNCTIONS.get(token.value)]);
    }
    if (token.type === 'word' && property?.[token.value]?.__compat) {
      features.push([`${declaration.prop}: ${token.value}`, property[token.value]]);
    }
  });
  return features;
}

function bareSelector(selector) {
  let bare = '';
  let closing = null;
  for (const char of selector) {
    if (closing) {
      if (char === closing) closing = null;
    } else if (char === '[') closing = ']';
    else if (char === '"' || char === "'") closing = char;
    else bare += char;
  }
  return bare;
}

function selectorFeatures(selector) {
  const bare = bareSelector(selector);
  return [...bare.matchAll(/(::?)([a-zA-Z-]+)/g)].map(([, colons, name]) => [
    `${colons}${name}`,
    bcd.css.selectors[name],
  ]);
}

function nodeFeatures(node) {
  if (node.type === 'atrule') return [[`@${node.name}`, bcd.css['at-rules'][node.name]]];
  if (node.type === 'rule') return selectorFeatures(node.selector);
  if (node.type === 'decl' && !hasFallback(node)) return declarationFeatures(node);
  return [];
}

export function cssCompatViolations(source, file, matrix) {
  const found = new Map();
  postcss.parse(source, { from: file }).walk((node) => {
    if (guardedBySupports(node)) return;
    for (const [feature, data] of nodeFeatures(node)) {
      const line = node.source?.start?.line ?? 0;
      const key = `${feature}@${line}`;
      const property = feature.includes(': ') && found.has(`${feature.split(': ')[0]}@${line}`);
      if (found.has(key) || property) continue;
      const missing = unsupported(data, matrix);
      if (missing.length) found.set(key, { feature, line, missing });
    }
  });
  return [...found.values()];
}

export function stylesheetFailures(uses, acknowledged = ACKNOWLEDGED_ENHANCEMENTS) {
  const failures = uses
    .filter((use) => !Object.hasOwn(acknowledged, use.feature))
    .map(
      (use) => `${use.file}:${use.line} uses ${use.feature}, missing in ${use.missing.join(', ')}.`,
    );
  const used = new Set(uses.map((use) => use.feature));
  for (const feature of Object.keys(acknowledged)) {
    if (!used.has(feature)) {
      failures.push(
        `scripts/check-css-compat.mjs acknowledges ${feature}, which no stylesheet needs on this matrix; remove it.`,
      );
    }
  }
  return failures;
}

function stylesheets(root, directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : stylesheets(root, relative);
    }
    return entry.name.endsWith('.css') ? [relative] : [];
  });
}

export function checkStylesheets(root, matrix) {
  const uses = STYLE_ROOTS.flatMap((directory) => stylesheets(root, directory)).flatMap((file) =>
    cssCompatViolations(fs.readFileSync(path.join(root, file), 'utf8'), file, matrix).map(
      (use) => ({ file, ...use }),
    ),
  );
  return stylesheetFailures(uses);
}
