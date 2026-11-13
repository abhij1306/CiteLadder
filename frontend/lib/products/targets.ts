import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';

/** Whether two targets name the same category or product. */
export function sameTarget(a: CommerceTarget, b: CommerceTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** A catalog target's own page: products and categories share `/products/:id`. */
export function targetHref(id: string): string {
  return `/products/${id}`;
}
