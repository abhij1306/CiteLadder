'use client';

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { commerceTargetSchema, type CommerceTarget } from '@citeladder/contracts/commerce-suite';

/** `category:<uuid>` — the one spelling of a target, shared by URL and payload. */
export function targetKey(target: CommerceTarget): string {
  return `${target.kind}:${target.id}`;
}

/** Whether two targets name the same category or product. */
export function sameTarget(a: CommerceTarget, b: CommerceTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** A well-formed `?target=` value, or undefined: a malformed one never reaches the API. */
export function parseTargetKey(value: string | null | undefined): CommerceTarget | undefined {
  const [kind, id] = (value ?? '').split(':');
  const parsed = commerceTargetSchema.safeParse({ kind, id });
  return parsed.success ? parsed.data : undefined;
}

/**
 * The selected Commerce target, held in the URL.
 *
 * There used to be three of these: `CompetitorsPanel` and `BuyerPromptsPanel`
 * each kept their own `useState`, and AI Shelf's lived further away again in
 * `products-screen.tsx`. One question — which category or product am I working
 * on? — answered in three places that never agreed, so switching view lost
 * your place and a reload lost all three. That is what made a target selector
 * necessary in every tab.
 *
 * In the URL it survives a reload, a deep link, and a back button, and it is
 * the same value the run payload is built from, so what is on screen is what
 * runs.
 */
export function useCommerceTarget() {
  const pathname = useLocation().pathname;
  const router = useNavigate();
  const searchParams = useSearchParams()[0];
  const target = parseTargetKey(searchParams?.get('target'));
  const selectTarget = (next: CommerceTarget | undefined) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next) params.set('target', targetKey(next));
    else params.delete('target');
    const query = params.toString();
    router(query ? `${pathname}?${query}` : pathname, { replace: true, preventScrollReset: true });
  };
  return { target, selectTarget };
}
