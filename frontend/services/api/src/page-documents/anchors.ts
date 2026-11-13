/**
 * Spans of a page document's Markdown body and how they move between two
 * revisions (content rules engine, "Findings and anchoring"). Offsets are
 * UTF-16 code units, half-open, as JavaScript and CodeMirror count them.
 *
 * Two revisions are compared line by line (longest common subsequence, with
 * each line keeping its newline), and each changed run of lines is narrowed
 * to the characters that differ. A span survives a change only when the
 * change lies wholly outside it; it then moves by what changed before it. A
 * span a change touches is gone, even if the same text appears elsewhere.
 */
import { policy } from '../config.ts';

const p = policy.content_optimization.suggestions;

export type Span = { start: number; end: number };
/** One changed region: `[from, to)` of the older body became `inserted` characters. */
type Change = { from: number; to: number; inserted: number };

/** The body's lines, each with its newline, so offsets add up to the body's length. */
function lines(body: string) {
  const parts = body.split('\n');
  const last = parts.pop() ?? '';
  const withNewlines = parts.map((line) => `${line}\n`);
  return last ? [...withNewlines, last] : withNewlines;
}

/** Offsets where each line starts, plus the body's length. */
function starts(parts: readonly string[]) {
  const at = [0];
  let offset = 0;
  for (const part of parts) {
    offset += part.length;
    at.push(offset);
  }
  return at;
}

/**
 * Suffix common subsequences of two line lists weighted by characters: cell
 * (i, j) is the most unchanged characters a[i..] and b[j..] can share. Weighing
 * by length keeps a paragraph or heading in place rather than a blank line,
 * so a moved paragraph does not drag its unchanged neighbours into the change.
 */
function lcsTable(a: readonly string[], b: readonly string[]) {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + a[i]!.length : Math.max(at(i + 1, j), at(i, j + 1));
  return at;
}

/** Line ranges `[i0, i1)` of `a` replaced by `[j0, j1)` of `b`, in order. */
type Hunk = { i0: number; i1: number; j0: number; j1: number };

function lineHunks(a: readonly string[], b: readonly string[]): Hunk[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  const room = Math.min(a.length, b.length) - head;
  while (tail < room && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const endA = a.length - tail;
  const endB = b.length - tail;
  if (head === endA && head === endB) return [];
  // Past the bound the whole middle is one change: coarser, never wrong.
  if ((endA - head + 1) * (endB - head + 1) > p.diff_max_cells)
    return [{ i0: head, i1: endA, j0: head, j1: endB }];
  return walkHunks(a.slice(head, endA), b.slice(head, endB), head);
}

/** The changed runs between `midA` and `midB` along their weighted LCS, offset by `head`. */
function walkHunks(midA: readonly string[], midB: readonly string[], head: number): Hunk[] {
  const at = lcsTable(midA, midB);
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      if (open) hunks.push(open);
      open = null;
      i++;
      j++;
      continue;
    }
    open ??= { i0: head + i, i1: head + i, j0: head + j, j1: head + j };
    if (j >= midB.length || (i < midA.length && at(i + 1, j) >= at(i, j + 1))) open.i1 = head + ++i;
    else open.j1 = head + ++j;
  }
  if (open) hunks.push(open);
  return hunks;
}

/** A changed run of characters narrowed to what differs: its common head and tail are unchanged. */
function narrowed(
  before: string,
  after: string,
  from: number,
  to: number,
  newFrom: number,
  newTo: number,
): Change {
  let head = 0;
  const shortest = Math.min(to - from, newTo - newFrom);
  while (head < shortest && before[from + head] === after[newFrom + head]) head++;
  let tail = 0;
  while (tail < shortest - head && before[to - 1 - tail] === after[newTo - 1 - tail]) tail++;
  return { from: from + head, to: to - tail, inserted: newTo - tail - (newFrom + head) };
}

/** What changed from one body to the next, as ordered, non-overlapping regions of the older body. */
export function bodyChanges(before: string, after: string): Change[] {
  if (before === after) return [];
  const a = lines(before);
  const b = lines(after);
  const offsetA = starts(a);
  const offsetB = starts(b);
  return lineHunks(a, b).map((hunk) =>
    narrowed(
      before,
      after,
      offsetA[hunk.i0]!,
      offsetA[hunk.i1]!,
      offsetB[hunk.j0]!,
      offsetB[hunk.j1]!,
    ),
  );
}

/** Whether a change alters the text of a span: it overlaps it, or inserts inside it. */
function touches(change: Change, span: Span) {
  if (change.from === change.to) return change.from > span.start && change.from < span.end;
  return change.from < span.end && change.to > span.start;
}

/** Where a span is after the changes, or null when one of them altered its text. */
export function mapSpan(changes: readonly Change[], span: Span): Span | null {
  let shift = 0;
  for (const change of changes) {
    if (touches(change, span)) return null;
    if (change.to <= span.start) shift += change.inserted - (change.to - change.from);
  }
  return { start: span.start + shift, end: span.end + shift };
}

/**
 * Replaces non-overlapping spans of a body in one pass. Returns the new body
 * and where each replacement now sits, in the order the edits were given.
 */
export function replaceSpans(body: string, edits: readonly { at: Span; text: string }[]) {
  const order = edits
    .map((edit, index) => ({ ...edit, index }))
    .toSorted((a, b) => a.at.start - b.at.start);
  const placed = new Map<number, Span>();
  let result = '';
  let cursor = 0;
  for (const { at, text, index } of order) {
    result += body.slice(cursor, at.start);
    placed.set(index, { start: result.length, end: result.length + text.length });
    result += text;
    cursor = at.end;
  }
  return {
    body: result + body.slice(cursor),
    placed: edits.map((_, index) => placed.get(index)!),
  };
}

/** Whether two spans share any character. */
export function overlaps(a: Span, b: Span) {
  return a.start < b.end && b.start < a.end;
}

/** A span's exact text and its context each side (W3C TextQuoteSelector). */
export function quoteOf(body: string, span: Span) {
  return {
    exact: body.slice(span.start, span.end),
    prefix: body.slice(Math.max(0, span.start - p.quote_context_chars), span.start),
    suffix: body.slice(span.end, span.end + p.quote_context_chars),
  };
}

const HEADING = /^#{1,6}[ \t]/u;

/** The body between the headings around a span: from the heading above it to the next heading after it. */
export function sectionOf(body: string, span: Span): Span {
  let start = 0;
  let end = body.length;
  let offset = 0;
  for (const line of lines(body)) {
    if (HEADING.test(line)) {
      if (offset <= span.start) start = offset;
      else if (offset >= span.end) {
        end = offset;
        break;
      }
    }
    offset += line.length;
  }
  return { start, end };
}
