'use client';

import { useQuery } from '@tanstack/react-query';

import { commerceQueries } from '@/lib/api/commerce';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { useCatalogProjection } from './use-catalog-projection';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

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
  const workspaceId = useActiveWorkspaceId();
  const hasProject = Boolean(projectId);
  const scope = { workspaceId, projectId };
  const catalog = useQuery({
    ...commerceQueries.catalog(scope),
    // No interval: while projections run, only their state is polled.
    enabled: hasProject,
  });
  const projection = useCatalogProjection(projectId, catalog);
  const competitors = useQuery({
    ...commerceQueries.competitors(scope),
    // No interval: the discovery tracker owns the in-flight signal and
    // invalidates this list when the last tracked run terminalizes.
    enabled: hasProject,
  });
  const buyerPrompts = useQuery({
    ...commerceQueries.buyerPrompts(scope),
    enabled: hasProject,
  });
  const shelf = useQuery({
    ...commerceQueries.shelf(scope, target ?? null),
    enabled: hasProject,
  });
  return { catalog, projection, competitors, buyerPrompts, shelf };
}
