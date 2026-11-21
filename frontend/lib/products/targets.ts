import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';

export function sameTarget(a: CommerceTarget, b: CommerceTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function targetHref(id: string): string {
  return `/products/${id}`;
}
