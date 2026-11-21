import { scopedKeys, type ProjectScope } from './scope';

const commerce = scopedKeys('commerce');
export const commerceKeys = {
  ...commerce,
  catalog: (scope: ProjectScope) => commerce.read('catalog', scope),
  catalogReadCount: (scope: ProjectScope) => commerce.read('catalog-read-count', scope),
  catalogProjection: (scope: ProjectScope) => commerce.read('catalog-projection', scope),
  products: (scope: ProjectScope, search: string, cursor: string | null) =>
    commerce.read('products', scope, search, cursor ?? 'first'),
  overview: (scope: ProjectScope, search: string) => commerce.read('overview', scope, search),
  competitors: (scope: ProjectScope) => commerce.read('competitors', scope),
  buyerPrompts: (scope: ProjectScope) => commerce.read('buyer-prompts', scope),
  discoveryTasks: (scope: ProjectScope, taskIds: readonly string[]) =>
    commerce.read('competitor-discoveries', scope, ...taskIds),
  activeDiscoveries: (scope: ProjectScope) =>
    commerce.read('competitor-discoveries', scope, 'active'),
  productDetail: (scope: ProjectScope, holderId: string, search: string) =>
    commerce.read('product-detail', scope, holderId, search),
};
