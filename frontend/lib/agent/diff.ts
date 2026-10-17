/**
 * A line diff between two revisions of an output, for a reader comparing
 * what changed. Longest-common-subsequence over lines, bounded so a very long
 * output cannot freeze the page; beyond the bound it reports null and the
 * caller shows both versions instead.
 */

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/** Lines-squared cells the table may hold (a ~2,000-line pair). */
const MAX_CELLS = 4_000_000;

/** Lengths of the common head and tail, which cost nothing to diff. */
function commonEnds(a: string[], b: string[]): [number, number] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  const room = Math.min(a.length, b.length) - head;
  while (tail < room && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [head, tail];
}

/** Suffix LCS lengths: cell (i, j) is the LCS of a[i..] and b[j..]. */
function lcsTable(a: string[], b: string[]): (i: number, j: number) => number {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  return at;
}

function walk(a: string[], b: string[]): DiffLine[] {
  const at = lcsTable(a, b);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && at(i + 1, j) >= at(i, j + 1))) {
      lines.push({ kind: 'removed', text: a[i++]! });
    } else {
      lines.push({ kind: 'added', text: b[j++]! });
    }
  }
  return lines;
}

export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  const [head, tail] = commonEnds(a, b);
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) return null;
  const same = (text: string): DiffLine => ({ kind: 'same', text });
  return [
    ...a.slice(0, head).map(same),
    ...walk(midA, midB),
    ...a.slice(a.length - tail).map(same),
  ];
}
