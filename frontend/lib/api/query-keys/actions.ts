import { scopedKeys, type ProjectScope } from './scope';

const actions = scopedKeys('actions');
export const actionKeys = {
  ...actions,
  list: (
    scope: ProjectScope,
    filters: {
      status: string | null;
      q: string | null;
      targetKind: string | null;
      approach: string | null;
      priority: string | null;
      family: string | null;
      cursor: string | null;
      limit: number;
    },
  ) => actions.read('list', scope, filters),
  tree: (scope: ProjectScope, params: Readonly<Record<string, string | undefined>>) =>
    actions.read('tree', scope, params),
  groupingRows: (
    scope: ProjectScope,
    params: Readonly<Record<string, string | undefined>>,
    cursor: string,
  ) => actions.read('grouping-rows', scope, params, cursor),
  analyzePages: (scope: ProjectScope, search: string) =>
    actions.read('analyze-pages', scope, search),
  urlActions: (scope: ProjectScope, siteUrlId: string) =>
    actions.read('url-actions', scope, siteUrlId),
  detail: (workspaceId: string | null, actionId: string) =>
    ['actions', 'detail', actionId, workspaceId] as const,
  urls: (workspaceId: string | null, actionId: string, cursor: string) =>
    ['actions', 'urls', actionId, workspaceId, cursor] as const,
};
