import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const aiTraffic = scopedKeys('ai-traffic');
export const aiTrafficKeys = {
  ...aiTraffic,
  view: <const View extends string>(scope: ProjectScope, view: View, filters: ListFilters = {}) =>
    aiTraffic.read(view, scope, filters),
  dashboard: (scope: ProjectScope, filters: ListFilters = {}) =>
    aiTraffic.read('dashboard', scope, filters),
};
