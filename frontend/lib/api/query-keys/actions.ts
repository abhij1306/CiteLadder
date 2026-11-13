/**
 * Actions query-key namespace — one unit of work per target. Lists are scoped
 * keys (`[actions, projectId, 'list', workspaceId, filters]`); a status change
 * or a declaration invalidates `actionKeys.all`.
 */
import { scopedKeys, type ProjectScope } from './scope';

const actions = scopedKeys('actions');
export const actionKeys = {
  ...actions,
  list: (
    scope: ProjectScope,
    filters: {
      status: string | null;
      targetKind: string | null;
      group: string | null;
      approach: string | null;
      priority: string | null;
      family: string | null;
      cursor: string | null;
      limit: number;
    },
  ) => actions.read('list', scope, filters),
  /** Analyze a page's picker: the latest crawl's content pages matching a search. */
  analyzePages: (scope: ProjectScope, search: string) =>
    actions.read('analyze-pages', scope, search),
  // An Action page knows only its id; the workspace follows it.
  detail: (workspaceId: string | null, actionId: string) =>
    ['actions', 'detail', actionId, workspaceId] as const,
};
