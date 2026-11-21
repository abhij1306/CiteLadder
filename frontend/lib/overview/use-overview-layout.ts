import { useMutation, useQuery } from '@tanstack/react-query';

import type { OverviewWidget } from '@citeladder/contracts/overview';
import { projectMutations, projectQueries } from '@/lib/api/projects';
import type { Project } from '@citeladder/contracts';

export function useOverviewLayout(project: Project) {
  const scope = { workspaceId: project.workspace_id, projectId: project.id };
  const query = useQuery(projectQueries.overviewLayout(scope));
  const mutation = useMutation(projectMutations.saveOverviewLayout(scope));
  return {
    query,
    pending: mutation.isPending,
    failed: mutation.isError,
    save: (widgets: OverviewWidget[] | null) => {
      if (!query.data || mutation.isPending) return;
      mutation.mutate({ widgets, version: query.data.version });
    },
  };
}
