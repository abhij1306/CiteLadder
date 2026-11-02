/**
 * Actions query-key namespace — one unit of work per target. Lists are keyed
 * by project and filters; a status change invalidates `actionKeys.all`.
 */
export const actionKeys = {
  all: ['actions'] as const,
  lists: (projectId: string) => ['actions', 'list', projectId] as const,
  /** The project at index 2 and its workspace beside it, for retained pages. */
  list: (
    workspaceId: string,
    projectId: string,
    filters: {
      status: string | null;
      targetKind: string | null;
      cursor: string | null;
      limit: number;
    },
  ) => ['actions', 'list', projectId, workspaceId, filters] as const,
  detail: (actionId: string) => ['actions', 'detail', actionId] as const,
};
