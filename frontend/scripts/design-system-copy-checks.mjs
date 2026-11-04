/**
 * Copy rules the design system owns.
 *
 * A heading never ends in a full stop (owner, 2026-11-03): headings, titles
 * and headlines are labels, not sentences, on every surface. A question mark
 * or an ellipsis is fine. Checked forms:
 *   - literal text of an `<h1>`–`<h6>` element;
 *   - a `title`, `heading` or `headline` prop on a component (a capitalised
 *     tag), so a native `title` tooltip attribute stays a sentence;
 *   - a `title`, `heading` or `headline` field in a content object.
 */

const ENDS_IN_FULL_STOP = /[^.]\.$/;

const HEADING_ELEMENT = /<h([1-6])\b[^>]*>([^<{}]*)<\/h\1>/g;
const COMPONENT_PROP =
  /<[A-Z][\w.]*\b[^<>]*?\b(?:title|heading|headline)=(?:"([^"]*)"|'([^']*)'|\{\s*(["'`])((?:(?!\3).)*)\3\s*\})/gs;
const CONTENT_FIELD = /(?<![\w.-])(?:title|heading|headline):\s*(["'`])((?:(?!\1)[^\n])*)\1/g;

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function violation(label, source, index, text) {
  return `${label}:${lineOf(source, index)}: heading ends in a full stop: "${text}"`;
}

export function headingPunctuationViolations(source, label) {
  if (/\.(?:test|spec)\.[jt]sx?$/.test(label)) return [];
  const found = [];
  const check = (index, raw) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (ENDS_IN_FULL_STOP.test(text)) found.push(violation(label, source, index, text));
  };
  for (const match of source.matchAll(HEADING_ELEMENT)) check(match.index, match[2]);
  for (const match of source.matchAll(COMPONENT_PROP)) {
    check(match.index, match[1] ?? match[2] ?? match[4] ?? '');
  }
  if (/\.(?:ts|tsx)$/.test(label)) {
    for (const match of source.matchAll(CONTENT_FIELD)) check(match.index, match[2]);
  }
  return found;
}
