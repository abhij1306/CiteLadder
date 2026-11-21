const placeScore = (place: number | null) => (place === null ? 0 : Math.max(0, 100 - 10 * place));

export function distinctPlaces<Key>(items: readonly { key: Key; rank: number }[]) {
  const places = new Map<Key, number>();
  for (const item of [...items].sort((a, b) => a.rank - b.rank))
    if (!places.has(item.key)) places.set(item.key, places.size);
  return places;
}

export function firstPlaces<Key>(items: readonly { key: Key; rank: number }[]) {
  const places = new Map<Key, number>();
  for (const item of items) {
    const prior = places.get(item.key);
    if (prior === undefined || item.rank < prior) places.set(item.key, item.rank);
  }
  return places;
}

export function positionScores<Key>(answers: readonly ReadonlyMap<Key, number>[]) {
  const totals = new Map<Key, { sum: number; raised: number }>();
  for (const places of answers)
    for (const [key, place] of places) {
      const total = totals.get(key) ?? { sum: 0, raised: 0 };
      total.sum += placeScore(place);
      total.raised += 1;
      totals.set(key, total);
    }
  return new Map(
    [...totals].map(([key, { sum, raised }]) => [
      key,
      { score: Math.round(sum / answers.length), raised },
    ]),
  );
}

export function scoreOf<Key>(
  scores: ReadonlyMap<Key, { score: number }>,
  key: Key,
  answers: number,
): number | null {
  if (!answers) return null;
  return scores.get(key)?.score ?? 0;
}

export function rankOf<Key>(entries: readonly { key: Key; score: number }[], subject: Key) {
  const own = entries.find((entry) => entry.key === subject);
  if (!own) return null;
  return 1 + entries.filter((entry) => entry.score > own.score).length;
}
