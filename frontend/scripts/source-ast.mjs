import { parseSync, visitorKeys } from 'oxc-parser';

/**
 * Shared parsing seam for the source-reading gates.
 *
 * These checks used to call the TypeScript compiler API directly. TypeScript 7
 * ships as a native binary and exposes no standalone parser — there is no
 * `createSourceFile` that turns a string into a tree, and no general
 * `forEachChild` — so every consumer moved onto oxc, the parser oxlint and
 * oxfmt already run. Keeping the parser behind one module means the next
 * migration edits this file instead of every gate.
 *
 * Node offsets are UTF-16 indices, so they index the source string directly.
 */

/**
 * Parse TSX/TS source into an ESTree program. Throws on a syntax error.
 *
 * A bare run of adjacent JSX elements is not a valid module, but it is how the
 * checks are most naturally exercised in isolation. The old TypeScript parser
 * accepted it; oxc reports "Adjacent JSX elements must be wrapped". Retry such
 * a snippet inside a fragment so a caller can hand over a JSX excerpt without
 * knowing which parser sits underneath.
 */
// The policy runs every check over one file before moving to the next, so
// remembering the last parse saves re-parsing that file once per check. One
// entry keeps memory flat across a whole-tree run.
let lastParse = { source: null, label: null, program: null };

export function parseSource(source, label) {
  if (lastParse.source === source && lastParse.label === label) return lastParse.program;
  const program = parseProgram(source, label);
  lastParse = { source, label, program };
  return program;
}

function parseProgram(source, label) {
  const { program, errors } = parseSync(label, source);
  if (!errors.length) return program;
  if (errors.some((error) => /Adjacent JSX elements/.test(error.message))) {
    const wrapped = parseSync(label, `<>${source}</>`);
    // Offsets now sit two characters past the original text.
    if (!wrapped.errors.length) return shiftOffsets(wrapped.program, -'<>'.length);
  }
  throw new Error(`${label}: could not parse — ${errors[0].message}`);
}

function shiftOffsets(node, delta) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (const item of node) shiftOffsets(item, delta);
    return node;
  }
  if (typeof node.start === 'number') node.start += delta;
  if (typeof node.end === 'number') node.end += delta;
  for (const key of Object.keys(node)) {
    if (key !== 'start' && key !== 'end') shiftOffsets(node[key], delta);
  }
  return node;
}

/** Walk every child node, depth first. The oxc analogue of `ts.forEachChild`. */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node.type !== 'string') return;
  visit(node);
  // `visitorKeys` lists only the child-bearing fields, so the walk skips the
  // span and type-annotation noise a blind key crawl would recurse into.
  for (const key of visitorKeys[node.type] ?? []) walk(node[key], visit);
}

/**
 * Map UTF-16 offsets to 1-based line numbers.
 *
 * Built once per file and reused; violation messages are line-addressed and a
 * per-node rescan turns the gate quadratic on the files that report most.
 */
export function lineIndex(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/** A string literal's text, or null. Covers `ts.isStringLiteralLike`. */
export function stringValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

/** Source text of a JSX element or attribute name (`div`, `Card`, `className`). */
export function nameText(node) {
  if (!node) return '';
  switch (node.type) {
    case 'JSXIdentifier':
    case 'Identifier':
      return node.name;
    case 'JSXNamespacedName':
      return `${nameText(node.namespace)}:${nameText(node.name)}`;
    case 'JSXMemberExpression':
      return `${nameText(node.object)}.${nameText(node.property)}`;
    default:
      return '';
  }
}

/** Unwrap the expression wrappers that carry no class information. */
export function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'ParenthesizedExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/** Every string and template fragment in a module, with its source offset. */
export function stringFragments(program) {
  const fragments = [];
  walk(program, (node) => {
    const text =
      node.type === 'TemplateElement'
        ? (node.value.cooked ?? node.value.raw ?? '')
        : stringValue(node);
    if (text) fragments.push({ text, start: node.start });
  });
  return fragments;
}
