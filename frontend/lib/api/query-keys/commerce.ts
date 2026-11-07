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
  competitors: (scope: ProjectScope) => commerce.read('competitors', scope),
  buyerPrompts: (scope: ProjectScope) => commerce.read('buyer-prompts', scope),
  discoveryTasks: (scope: ProjectScope, taskIds: readonly string[]) =>
    commerce.read('competitor-discoveries', scope, ...taskIds),
  /** Whatever discovery is in flight for the project, per the server. */
  activeDiscoveries: (scope: ProjectScope) =>
    commerce.read('competitor-discoveries', scope, 'active'),
  shelf: (scope: ProjectScope, target: { kind: string; id: string } | null) =>
    commerce.read('ai-shelf', scope, target?.kind ?? 'no-target', target?.id ?? 'no-target'),
};
