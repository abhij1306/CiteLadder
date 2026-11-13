import { useQuery } from '@tanstack/react-query';

import { commerceQueries } from '@/lib/api/commerce';
import { useCatalogProjection } from './use-catalog-projection';
import { useProjectScope } from '@/lib/project/active-project-scope';

/**
 * The project-wide Commerce reads the Products screens share: the catalog
 * (the navigation) with its projection progress, competitor candidates and
 * buyer prompts. A product's page filters the last two to itself.
 */
export function useCommerceQueries(projectId: string) {
  const { workspaceId } = useProjectScope();
  const scope = { workspaceId, projectId };
  // No interval: while projections run, only their state is polled.
  const catalog = useQuery(commerceQueries.catalog(scope));
  const projection = useCatalogProjection(projectId, catalog);
  // No interval: the discovery tracker owns the in-flight signal and
  // invalidates this list when the last tracked run terminalizes.
  const competitors = useQuery(commerceQueries.competitors(scope));
  const buyerPrompts = useQuery(commerceQueries.buyerPrompts(scope));
  return { catalog, projection, competitors, buyerPrompts };
}
