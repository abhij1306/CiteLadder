'use client';

import { useProjectScope } from '@/lib/project/active-project-scope';

import { CommerceWorkspace } from './commerce-workspace';

/**
 * Commerce is one screen, not four tabs.
 *
 * The tabs were verbs — Catalog, Competitors, Buyer Prompts, AI Shelf — and
 * each one re-asked the same noun, so the target selector was duplicated three
 * times over three selection states that never agreed. The catalog is the
 * navigation now and everything else is a view of the selected target, held in
 * `?target=`.
 */
export function ProductsScreen() {
  return <CommerceWorkspace projectId={useProjectScope().projectId} />;
}
