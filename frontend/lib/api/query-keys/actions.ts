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
      cursor: string | null;
      limit: number;
    },
  ) => actions.read('list', scope, filters),
  // An Action page knows only its id; the workspace follows it.
  detail: (workspaceId: string | null, actionId: string) =>
    ['actions', 'detail', actionId, workspaceId] as const,
};
