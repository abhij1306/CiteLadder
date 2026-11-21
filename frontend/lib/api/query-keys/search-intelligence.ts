import { scopedKeys, type ProjectScope } from './scope';
import type { ListFilters } from './shared';

const searchIntelligence = scopedKeys('search-intelligence');
export const searchIntelligenceKeys = {
  ...searchIntelligence,
  readiness: (scope: ProjectScope) => searchIntelligence.read('readiness', scope),
  runs: (scope: ProjectScope) => searchIntelligence.read('runs', scope),
  datasetRows: (scope: ProjectScope, datasetId: string, params: ListFilters) =>
    searchIntelligence.read('dataset', scope, datasetId, 'rows', params),
  datasetHistory: (scope: ProjectScope, datasetId: string) =>
    searchIntelligence.read('dataset', scope, datasetId, 'history'),
};
