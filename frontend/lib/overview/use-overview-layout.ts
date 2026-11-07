import { useMutation, useQuery } from '@tanstack/react-query';

import type { OverviewWidget } from '@citeladder/contracts/overview';
import { projectMutations, projectQueries } from '@/lib/api/projects';
import type { Project } from '@citeladder/contracts';

/**
 * The project's shared Overview layout. A save names the version it edited, so
 * a stale save fails instead of overwriting someone else's arrangement; the
 * failed save rolls back and refetches the layout that won.
 */
export function useOverviewLayout(project: Project) {
  const scope = { workspaceId: project.workspace_id, projectId: project.id };
  const query = useQuery(projectQueries.overviewLayout(scope));
  const mutation = useMutation(projectMutations.saveOverviewLayout(scope));
  return {
    query,
    pending: mutation.isPending,
    failed: mutation.isError,
    /** `null` resets to the default layout. */
    save: (widgets: OverviewWidget[] | null) => {
      if (!query.data || mutation.isPending) return;
      mutation.mutate({ widgets, version: query.data.version });
    },
  };
}
