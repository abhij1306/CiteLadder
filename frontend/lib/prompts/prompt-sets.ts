import type { PromptSet } from '@citeladder/contracts';

const byAge = (a: PromptSet, b: PromptSet) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

export function oldestFirst(sets: readonly PromptSet[]): PromptSet[] {
  return [...sets].sort(byAge);
}

export function libraryOrder(sets: readonly PromptSet[]): PromptSet[] {
  const ordered = oldestFirst(sets);
  return [
    ...ordered.filter((set) => set.kind !== 'commerce'),
    ...ordered.filter((set) => set.kind === 'commerce'),
  ];
}

export function rowSetNames(sets: readonly PromptSet[]): ReadonlyMap<string, string> {
  const brandSets = sets.filter((set) => set.kind !== 'commerce').length;
  return new Map(brandSets > 1 ? sets.map((set) => [set.id, set.name]) : []);
}

export function mainPromptSet(sets: readonly PromptSet[]): PromptSet | null {
  return oldestFirst(sets).find((set) => set.kind === 'brand') ?? null;
}
