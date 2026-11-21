import { policy } from '../config.ts';

const p = policy.content_optimization.suggestions;

export type Span = { start: number; end: number };
type Change = { from: number; to: number; inserted: number };

function lines(body: string) {
  const parts = body.split('\n');
  const last = parts.pop() ?? '';
  const withNewlines = parts.map((line) => `${line}\n`);
  return last ? [...withNewlines, last] : withNewlines;
}

function starts(parts: readonly string[]) {
  const at = [0];
  let offset = 0;
  for (const part of parts) {
    offset += part.length;
    at.push(offset);
  }
  return at;
}

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
  if ((endA - head + 1) * (endB - head + 1) > p.diff_max_cells)
    return [{ i0: head, i1: endA, j0: head, j1: endB }];
  return walkHunks(a.slice(head, endA), b.slice(head, endB), head);
}

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

function touches(change: Change, span: Span) {
  if (change.from === change.to) return change.from > span.start && change.from < span.end;
  return change.from < span.end && change.to > span.start;
}

export function mapSpan(changes: readonly Change[], span: Span): Span | null {
  let shift = 0;
  for (const change of changes) {
    if (touches(change, span)) return null;
    if (change.to <= span.start) shift += change.inserted - (change.to - change.from);
  }
  return { start: span.start + shift, end: span.end + shift };
}

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

export function overlaps(a: Span, b: Span) {
  return a.start < b.end && b.start < a.end;
}

export function quoteOf(body: string, span: Span) {
  return {
    exact: body.slice(span.start, span.end),
    prefix: body.slice(Math.max(0, span.start - p.quote_context_chars), span.start),
    suffix: body.slice(span.end, span.end + p.quote_context_chars),
  };
}

const HEADING = /^#{1,6}[ \t]/u;

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
