export type NonEmpty<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(items: readonly T[]): items is NonEmpty<T> {
  return items.length > 0;
}

export function lastOf<T>(items: NonEmpty<T>): T {
  return items.reduce((_, item) => item);
}

export function firstOf<T>(items: readonly T[], what: string): T {
  if (!isNonEmpty(items)) throw new Error(`Expected ${what}`);
  return items[0];
}

export function onlyOf<T>(items: Iterable<T>): T | undefined {
  let only: T | undefined;
  let seen = 0;
  for (const item of items) {
    if (++seen > 1) return undefined;
    only = item;
  }
  return only;
}

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

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  const union = new Set([...a, ...b]).size;
  if (!union) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / union;
}

const ID_CHUNK = 5000;

export function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size));
  return chunks;
}

export async function chunked<T>(
  ids: readonly string[],
  read: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  return (await Promise.all(chunksOf(ids, ID_CHUNK).map(read))).flat();
}
