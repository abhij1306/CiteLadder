/** A list that holds at least one item, so its first and last items exist. */
export type NonEmpty<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(items: readonly T[]): items is NonEmpty<T> {
  return items.length > 0;
}

/** The last item of a list that holds at least one, even when that item is nullish. */
export function lastOf<T>(items: NonEmpty<T>): T {
  return items.reduce((_, item) => item);
}

/**
 * The first item of a list the caller's invariant says is non-empty, such as
 * the row an insert returns or the view built for one loaded record. `what`
 * names the expected item, so a broken invariant fails with that name.
 */
export function firstOf<T>(items: readonly T[], what: string): T {
  if (!isNonEmpty(items)) throw new Error(`Expected ${what}`);
  return items[0];
}

/** The item of a one-item collection; undefined when it holds none or several. */
export function onlyOf<T>(items: Iterable<T>): T | undefined {
  let only: T | undefined;
  let seen = 0;
  for (const item of items) {
    if (++seen > 1) return undefined;
    only = item;
  }
  return only;
}

/** Rows grouped by key in first-seen order; a group exists only once it holds a row. */
export function groupBy<T, K>(rows: Iterable<T>, key: (row: T) => K): Map<K, [T, ...T[]]> {
  const groups = new Map<K, [T, ...T[]]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

// Bind parameters per statement stay far below PostgreSQL's 65,535 limit.
const ID_CHUNK = 5000;

/** `items` split into consecutive slices of at most `size`. */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size));
  return chunks;
}

/** `read` over `ids` in bounded chunks, run concurrently and concatenated. */
export async function chunked<T>(
  ids: readonly string[],
  read: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  return (await Promise.all(chunksOf(ids, ID_CHUNK).map(read))).flat();
}
