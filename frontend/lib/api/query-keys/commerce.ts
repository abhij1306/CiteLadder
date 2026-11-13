/** Atomic Commerce suite query-key namespace. */
import { scopedKeys, type ProjectScope } from './scope';

const commerce = scopedKeys('commerce');
export const commerceKeys = {
  ...commerce,
  catalog: (scope: ProjectScope) => commerce.read('catalog', scope),
  /** The crawl's analyzed count the cached catalog was read beside (client-only, no request). */
  catalogReadCount: (scope: ProjectScope) => commerce.read('catalog-read-count', scope),
  /** Projection progress alone; a sibling of `catalog`, so invalidating one leaves the other. */
  catalogProjection: (scope: ProjectScope) => commerce.read('catalog-projection', scope),
  /** One Products page: the filters' query string and the page's cursor. */
  products: (scope: ProjectScope, search: string, cursor: string | null) =>
    commerce.read('products', scope, search, cursor ?? 'first'),
  /** The Shopping overview for the filters' query string (`overviewSearch`). */
  overview: (scope: ProjectScope, search: string) => commerce.read('overview', scope, search),
  competitors: (scope: ProjectScope) => commerce.read('competitors', scope),
  buyerPrompts: (scope: ProjectScope) => commerce.read('buyer-prompts', scope),
  discoveryTasks: (scope: ProjectScope, taskIds: readonly string[]) =>
    commerce.read('competitor-discoveries', scope, ...taskIds),
  /** Whatever discovery is in flight for the project, per the server. */
  activeDiscoveries: (scope: ProjectScope) =>
    commerce.read('competitor-discoveries', scope, 'active'),
  /** One product holder's page for the window's query string. */
  productDetail: (scope: ProjectScope, holderId: string, search: string) =>
    commerce.read('product-detail', scope, holderId, search),
};
