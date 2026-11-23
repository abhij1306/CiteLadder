import path from 'node:path';

import { parseSync } from 'oxc-parser';

import { lineIndex } from './source-ast.mjs';

const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.astro',
  '.css',
]);

const IGNORE = [
  /(?:^|\/)generated\//u,
  /(?:^|\/)migrations\//u,
  /(?:^|\/)db-schema\.ts$/u,
  /\.gen\.ts$/u,
  /(?:^|\/)worker-configuration\.d\.ts$/u,
  /^frontend\/apps\/docs\/public\/templates\//u,
];

const RULES = String.raw`(?: [\w@/-]+(?:, ?[\w@/-]+)*)?`;
const DIRECTIVES = [
  new RegExp(String.raw`^(?:oxlint|eslint)-(?:disable|enable)(?:-next-line|-line)?${RULES}$`, 'u'),
  new RegExp(String.raw`^react-doctor-disable(?:-next-line|-line)?${RULES}$`, 'u'),
  /^NOSONAR$/u,
  /^@ts-expect-error$/u,
  /^\/ <reference (?:path|types|lib)="[^"]+" \/>$/u,
  /^@vitest-environment [\w-]+$/u,
  /^(?:v8|c8|istanbul) ignore(?: next| else| if| start| stop| file)?$/u,
  /^@vite-ignore$/u,
  /^prettier-ignore$/u,
  /^[#@]__PURE__$/u,
  /^@jsxImportSource [\w@/.-]+$/u,
  /^@public$/u,
];

export function isCommentChecked(file) {
  return EXTENSIONS.has(path.posix.extname(file)) && !IGNORE.some((glob) => glob.test(file));
}

function isDirective({ kind, value }) {
  if (kind === 'html') return false;
  const text = kind === 'line' && value.startsWith('/') ? value : value.replace(/^\*+/u, '').trim();
  return DIRECTIVES.some((pattern) => pattern.test(text));
}

function scriptComments({ source, label, offset = 0 }) {
  const { comments, errors } = parseSync(label, source);
  if (errors.length) throw new Error(`${label}: could not parse — ${errors[0].message}`);
  const hashbang = source.startsWith('#!');
  return comments
    .filter(({ start }) => !(hashbang && start === 0))
    .map(({ type, value, start }) => ({
      kind: type === 'Line' ? 'line' : 'block',
      value,
      start: start + offset,
    }));
}

function cssComments(source, offset = 0) {
  const found = [];
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close < 0 ? source.length : close;
      found.push({ kind: 'block', value: source.slice(index + 2, end), start: index + offset });
      index = end + 1;
    }
  }
  return found;
}

function expressionEnd({ source, open, label }) {
  for (let close = source.indexOf('}', open); close >= 0; close = source.indexOf('}', close + 1)) {
    if (!parseSync(`${label}.tsx`, `<>{${source.slice(open + 1, close)}}</>`).errors.length)
      return close;
  }
  throw new Error(`${label}: unterminated expression at offset ${open}`);
}

function astroComments(source, label) {
  const found = [];
  let index = 0;
  const fence = /^\s*---\r?\n/u.exec(source);
  if (fence) {
    const close = source.indexOf('\n---', fence[0].length - 1);
    found.push(
      ...scriptComments({
        source: source.slice(fence[0].length, close),
        label: `${label}.ts`,
        offset: fence[0].length,
      }),
    );
    index = close + 4;
  }
  while (index < source.length) {
    const head = source.slice(index, index + 8).toLowerCase();
    const raw = /^<(script|style)[\s>]/u.exec(head);
    if (head.startsWith('<!--')) {
      const close = source.indexOf('-->', index);
      found.push({ kind: 'html', value: source.slice(index + 4, close), start: index });
      index = close < 0 ? source.length : close + 3;
    } else if (raw) {
      const bodyStart = source.indexOf('>', index) + 1;
      const close = source.toLowerCase().indexOf(`</${raw[1]}`, bodyStart);
      const bodyEnd = close < 0 ? source.length : close;
      const body = source.slice(bodyStart, bodyEnd);
      found.push(
        ...(raw[1] === 'script'
          ? scriptComments({ source: body, label: `${label}.ts`, offset: bodyStart })
          : cssComments(body, bodyStart)),
      );
      index = bodyEnd + 1;
    } else if (source[index] === '{') {
      const close = expressionEnd({ source, open: index, label });
      const wrapped = `<>{${source.slice(index + 1, close)}}</>`;
      found.push(...scriptComments({ source: wrapped, label: `${label}.tsx`, offset: index - 2 }));
      index = close + 1;
    } else {
      index += 1;
    }
  }
  return found;
}

function sourceComments(source, file) {
  const extension = path.posix.extname(file);
  if (extension === '.css') return cssComments(source);
  if (extension === '.astro') return astroComments(source, file);
  return scriptComments({ source, label: file });
}

export function commentFindings(source, file) {
  const lineOf = lineIndex(source);
  return sourceComments(source, file)
    .filter((comment) => !isDirective(comment))
    .map(({ start }) => ({
      file,
      line: lineOf(start),
      text: source.slice(start).split('\n')[0].slice(0, 100),
    }));
}
