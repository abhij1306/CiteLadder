/** Search Intelligence query keys, on the shared scoped-key builder. */
import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const searchIntelligence = scopedKeys('search-intelligence');
export const searchIntelligenceKeys = {
  ...searchIntelligence,
  readiness: (scope: ProjectScope) => searchIntelligence.read('readiness', scope),
  runs: (scope: ProjectScope) => searchIntelligence.read('runs', scope),
  /** One page of a saved dataset's rows: its order, filters and cursor. */
  datasetRows: (scope: ProjectScope, datasetId: string, params: ListFilters) =>
    searchIntelligence.read('dataset', scope, datasetId, 'rows', params),
  /** A saved dataset's monthly history, read whole for its chart. */
  datasetHistory: (scope: ProjectScope, datasetId: string) =>
    searchIntelligence.read('dataset', scope, datasetId, 'history'),
};
