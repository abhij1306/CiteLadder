/**
 * The table-writer gate: every table has one TypeScript application writer.
 * The API service's allowlist (`frontend/services/api/table-writers.json`)
 * records each table's writer modules. A write from a module the allowlist
 * does not name fails, as does a listed writer that no longer writes. Against
 * a base revision, a table may not gain writers and a new table enters with
 * one. scripts/table-writers.test.mjs runs the gate on the repository.
 *
 * Writes are read from source text: Kysely's `insertInto`, `updateTable`,
 * `deleteFrom` and `mergeInto` with a literal table, and `INSERT INTO`,
 * `UPDATE … SET`, `DELETE FROM` and `MERGE INTO` inside string and template
 * literals. A write whose table is computed (a Kysely variable or template
 * literal, or a `${…}` table in SQL) is a dynamic writer; the allowlist names
 * those modules separately. Only tables of the generated database schema
 * count. Dependency-free, so it runs without an install.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const KYSELY_WRITE =
  /\b(?:insertInto|updateTable|deleteFrom|mergeInto)\s*\(\s*(?:(['"])([^'"]*)\1)?/gu;
// A table name, or (group 2) the placeholder `lexSource` puts where a template interpolates one.
const IDENTIFIER = String.raw`(?:(?:public\.)?"?([a-z_][a-z0-9_]*)"?|(\?))`;
const SQL_WRITES = [
  new RegExp(String.raw`\binsert\s+into\s+${IDENTIFIER}`, 'giu'),
  new RegExp(String.raw`\bmerge\s+into\s+${IDENTIFIER}`, 'giu'),
  new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${IDENTIFIER}`, 'giu'),
  new RegExp(
    String.raw`\bupdate\s+(?:only\s+)?${IDENTIFIER}(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\b`,
    'giu',
  ),
];
// After these characters a `/` starts a regular expression, not a division.
const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^');
const compare = (left, right) => (left < right ? -1 : Number(left > right));
const REGEX_KEYWORDS = /\b(?:return|typeof|case|do|else|in|of|void|yield|await)$/u;

function skipRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length && source[index] !== '\n') {
    const char = source[index];
    if (char === '\\') index += 1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) break;
    index += 1;
  }
  index += 1;
  while (/[a-z]/iu.test(source[index] ?? '')) index += 1;
  return index;
}

function startsRegex(code) {
  const before = code.trimEnd();
  return before === '' || REGEX_PRECEDERS.has(before.at(-1)) || REGEX_KEYWORDS.test(before);
}

/**
 * Split a TypeScript module into its code (comments removed, literals kept)
 * and the text of its string and template literals. A template's parts join
 * with a placeholder, so a statement split by `${…}` still reads as one.
 */
export function lexSource(source) {
  const state = { source, index: 0, depth: 0, code: '', strings: [], templates: [] };
  while (state.index < source.length) lexToken(state);
  return { code: state.code, strings: state.strings };
}

/** The end of the comment starting at `index`, or -1 when none starts there. */
function commentEnd(source, index) {
  if (source.startsWith('//', index)) {
    const end = source.indexOf('\n', index);
    return end < 0 ? source.length : end;
  }
  if (source.startsWith('/*', index)) {
    const end = source.indexOf('*/', index + 2);
    return end < 0 ? source.length : end + 2;
  }
  return -1;
}

function lexToken(state) {
  const { source, index } = state;
  const char = source[index];
  const comment = commentEnd(source, index);
  if (comment >= 0) state.index = comment;
  else if (char === "'" || char === '"') lexQuoted(state, char);
  else if (char === '`') {
    state.code += '`';
    state.index += 1;
    // Each open template: its text so far and the `${` brace depth it resumes at.
    state.templates.push({ text: '', resumeDepth: -1 });
    lexTemplate(state);
  } else if (char === '/' && startsRegex(state.code)) {
    state.index = skipRegex(source, index);
    state.code += source.slice(index, state.index);
  } else if (char === '}') {
    state.depth -= 1;
    state.index += 1;
    if (state.templates.at(-1)?.resumeDepth === state.depth) lexTemplate(state);
    else state.code += char;
  } else {
    if (char === '{') state.depth += 1;
    state.code += char;
    state.index += 1;
  }
}

function lexQuoted(state, quote) {
  const { source, index } = state;
  let end = index + 1;
  while (end < source.length && source[end] !== quote && source[end] !== '\n')
    end += source[end] === '\\' ? 2 : 1;
  state.strings.push(source.slice(index + 1, end));
  state.code += source.slice(index, end + 1);
  state.index = end + 1;
}

/** Read the open template's text up to its end or its next `${`. */
function lexTemplate(state) {
  const { source } = state;
  const template = state.templates.at(-1);
  while (state.index < source.length) {
    const char = source[state.index];
    if (char === '`') {
      state.code += '`';
      state.index += 1;
      state.strings.push(state.templates.pop().text);
      return;
    }
    if (source.startsWith('${', state.index)) {
      template.text += ' ? ';
      template.resumeDepth = state.depth;
      state.depth += 1;
      state.index += 2;
      return;
    }
    const length = char === '\\' ? 2 : 1;
    template.text += source.slice(state.index, state.index + length);
    state.index += length;
  }
}

/** The tables a module writes, and whether it writes a table it computes. */
export function moduleWrites(source, knownTables) {
  const { code, strings } = lexSource(source);
  const tables = new Set();
  let dynamic = false;
  for (const match of code.matchAll(KYSELY_WRITE)) {
    if (match[2] === undefined) {
      dynamic = true;
      continue;
    }
    // `'projects as p'` names `projects`.
    const table = match[2]
      .trim()
      .split(/\s/u)[0]
      .replace(/^public\./u, '');
    if (knownTables.has(table)) tables.add(table);
  }
  for (const text of strings)
    for (const pattern of SQL_WRITES)
      for (const match of text.matchAll(pattern)) {
        if (match[2]) dynamic = true;
        else if (knownTables.has(match[1].toLowerCase())) tables.add(match[1].toLowerCase());
      }
  return { tables: [...tables].sort(compare), dynamic };
}

/** The table names of the generated schema's `DB` interface. */
export function schemaTables(schemaSource) {
  const body = /export interface DB \{([^}]*)\}/u.exec(schemaSource)?.[1];
  if (!body) throw new Error('the generated schema declares no DB interface');
  const names = body.split('\n').map((line) => /^([a-z_][a-z0-9_]*):/u.exec(line.trim())?.[1]);
  return new Set(names.filter(Boolean));
}

/** Every table's writer modules and the dynamic writers, as the allowlist records them. */
export function collectWriters(modules, knownTables) {
  const tables = {};
  const dynamic = [];
  for (const [path, source] of [...modules].sort(([left], [right]) => compare(left, right))) {
    const writes = moduleWrites(source, knownTables);
    for (const table of writes.tables) {
      tables[table] ??= [];
      tables[table].push(path);
    }
    if (writes.dynamic) dynamic.push(path);
  }
  const sortedTables = Object.fromEntries(
    Object.entries(tables).sort(([left], [right]) => compare(left, right)),
  );
  return { format_version: 1, tables: sortedTables, dynamic_writers: dynamic };
}

/** The shipped API modules (`src/`, `scripts/`), keyed by their path below the package. */
export function apiModules(apiRoot) {
  const modules = new Map();
  for (const directory of ['src', 'scripts']) {
    const entries = readdirSync(join(apiRoot, directory), { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.[cm]?[jt]s$/u.test(entry.name) || entry.name.endsWith('.d.ts'))
        continue;
      const path = join(entry.parentPath, entry.name);
      modules.set(relative(apiRoot, path).split(sep).join('/'), readFileSync(path, 'utf8'));
    }
  }
  return modules;
}

export function validateAllowlist(raw) {
  const isPathList = (value) =>
    Array.isArray(value) && value.every((path) => typeof path === 'string' && path.length > 0);
  if (
    raw?.format_version !== 1 ||
    !raw.tables ||
    typeof raw.tables !== 'object' ||
    Array.isArray(raw.tables) ||
    !Object.values(raw.tables).every(isPathList) ||
    !isPathList(raw.dynamic_writers)
  )
    throw new Error('invalid table-writer allowlist');
  return raw;
}

function pairs(allowlist) {
  return new Set([
    ...Object.entries(allowlist.tables).flatMap(([table, paths]) =>
      paths.map((path) => `${table} <- ${path}`),
    ),
    ...allowlist.dynamic_writers.map((path) => `<dynamic table> <- ${path}`),
  ]);
}

/** Writes the allowlist does not name, and listed writers that no longer write. */
export function writerFailures(observed, allowlist) {
  const actual = pairs(observed);
  const allowed = pairs(allowlist);
  return [
    ...[...actual].filter((pair) => !allowed.has(pair)).map((pair) => `unlisted writer: ${pair}`),
    ...[...allowed].filter((pair) => !actual.has(pair)).map((pair) => `stale writer: ${pair}`),
  ];
}

/** The allowlist only tightens: no table gains writers, a new table has one. */
export function allowlistDiffFailures(base, current) {
  const failures = [];
  for (const [table, paths] of Object.entries(current.tables)) {
    const before = base.tables[table]?.length ?? 1;
    if (paths.length > before)
      failures.push(`'${table}' has ${paths.length} writers; it may have at most ${before}`);
  }
  if (current.dynamic_writers.length > base.dynamic_writers.length)
    failures.push(
      `dynamic-table writers grew ${base.dynamic_writers.length} -> ${current.dynamic_writers.length}`,
    );
  return failures;
}
