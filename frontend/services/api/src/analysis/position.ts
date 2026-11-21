type Offsets = Readonly<Record<string, unknown>>;

function isOffset(value: unknown): value is number {
  return typeof value === 'number';
}

export function brandPosition(brandOffset: unknown, competitorOffsets: Offsets): number | null {
  if (!isOffset(brandOffset)) return null;
  const ahead = Object.values(competitorOffsets).filter(
    (offset) => isOffset(offset) && offset < brandOffset,
  ).length;
  return ahead + 1;
}

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
