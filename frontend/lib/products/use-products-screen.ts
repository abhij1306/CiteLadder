import { useQuery } from '@tanstack/react-query';

import { commerceQueries } from '@/lib/api/commerce';
import { useCatalogProjection } from './use-catalog-projection';
import { useProjectScope } from '@/lib/project/active-project-scope';

export function useCommerceQueries(projectId: string) {
  const { workspaceId } = useProjectScope();
  const scope = { workspaceId, projectId };
  const catalog = useQuery(commerceQueries.catalog(scope));
  const projection = useCatalogProjection(projectId, catalog);
  const competitors = useQuery(commerceQueries.competitors(scope));
  const buyerPrompts = useQuery(commerceQueries.buyerPrompts(scope));
  return { catalog, projection, competitors, buyerPrompts };
}
