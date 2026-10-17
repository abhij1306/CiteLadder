/**
 * Where a brand sits among the brands one answer names.
 *
 * A rank is arithmetic
 * over first-mention offsets; an entity the answer never named has no rank,
 * which is not last place.
 */

type Offsets = Readonly<Record<string, unknown>>;

function isOffset(value: unknown): value is number {
  return typeof value === 'number';
}

/** The brand's 1-based rank among the brands named in one answer, or null. */
export function brandPosition(brandOffset: unknown, competitorOffsets: Offsets): number | null {
  // Unnamed, unresolved or malformed: no rank, never a guessed one.
  if (!isOffset(brandOffset)) return null;
  const ahead = Object.values(competitorOffsets).filter(
    (offset) => isOffset(offset) && offset < brandOffset,
  ).length;
  return ahead + 1;
}

/** One competitor's rank inside one answer, by the same offset ordering. */
export function competitorPosition(score: Offsets, name: string): number | null {
  const offsets = (score.competitor_first_offsets || {}) as Offsets;
  const own = Object.hasOwn(offsets, name) ? offsets[name] : null;
  if (!isOffset(own)) return null;
  const brandOffset = score.brand_first_offset;
  let ahead = Object.entries(offsets).filter(
    ([other, offset]) => other !== name && isOffset(offset) && offset < own,
  ).length;
  if (isOffset(brandOffset) && brandOffset < own) ahead += 1;
  return ahead + 1;
}
