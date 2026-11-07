'use client';

import { useQuery } from '@tanstack/react-query';

import { commerceQueries } from '@/lib/api/commerce';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { useCatalogProjection } from './use-catalog-projection';
import { useProjectScope } from '@/lib/project/active-project-scope';

/**
 * Every Commerce read for the workspace, gated on the selected target rather
 * than on which tab is open.
 *
 * The tab argument is gone with the tabs: competitors, prompts, and shelf were
 * each fetched only while their own tab was mounted, which is why selecting a
 * target in one view told the others nothing. The catalog is always loaded (it
 * is the navigation), and the three target-scoped reads follow the selection.
 */
export function useCommerceQueries(projectId: string, target?: CommerceTarget) {
  const { workspaceId } = useProjectScope();
  const scope = { workspaceId, projectId };
  // No interval: while projections run, only their state is polled.
  const catalog = useQuery(commerceQueries.catalog(scope));
  const projection = useCatalogProjection(projectId, catalog);
  // No interval: the discovery tracker owns the in-flight signal and
  // invalidates this list when the last tracked run terminalizes.
  const competitors = useQuery(commerceQueries.competitors(scope));
  const buyerPrompts = useQuery(commerceQueries.buyerPrompts(scope));
  const shelf = useQuery(commerceQueries.shelf(scope, target ?? null));
  return { catalog, projection, competitors, buyerPrompts, shelf };
}
