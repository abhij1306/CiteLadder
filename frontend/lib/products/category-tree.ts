import type { CommerceCatalog } from '@citeladder/contracts/commerce-suite';

type Category = CommerceCatalog['categories'][number];

export function nestedCategories(
  categories: readonly Category[],
): { category: Category; depth: number }[] {
  const listed = new Set(categories.map((row) => row.id));
  const children = new Map<string | null, Category[]>();
  for (const row of categories) {
    const parent = row.parent_id && listed.has(row.parent_id) ? row.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }
  const out: { category: Category; depth: number }[] = [];
  const placed = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const category of children.get(parent) ?? []) {
      if (placed.has(category.id)) continue;
      placed.add(category.id);
      out.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const category of categories)
    if (!placed.has(category.id)) {
      placed.add(category.id);
      out.push({ category, depth: 0 });
    }
  return out;
}
