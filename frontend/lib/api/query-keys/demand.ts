import { scopedKeys, type ProjectScope } from './scope';

const demand = scopedKeys('demand');
export const demandKeys = {
  ...demand,
  latest: (scope: ProjectScope) => demand.read('latest', scope),
};
