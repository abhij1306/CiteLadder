/**
 * AI Traffic queries sit on the shared scoped-key builder: every read binds
 * the project, the view (resource), the workspace and the selected filters.
 * The retained referrals dashboard keeps its window and granularity in the key.
 */
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
