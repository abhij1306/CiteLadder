import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { OverviewLayout, OverviewWidget } from '@citeladder/contracts/overview';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import type { Project } from '@/lib/api/types';

/**
 * The project's shared Overview layout. A save names the version it edited, so
 * a stale save fails instead of overwriting someone else's arrangement; the
 * failed save rolls back and refetches the layout that won.
 */
export function useOverviewLayout(project: Project) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.projects.overviewLayout(project.id);
  const options = { workspaceId: project.workspace_id };
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => projectsApi.getOverviewLayout(project.id, { ...options, signal }),
  });
  const mutation = useMutation({
    mutationFn: ({ widgets, version }: { widgets: OverviewWidget[] | null; version: number }) =>
      projectsApi.updateOverviewLayout(project.id, { widgets, expected_version: version }, options),
    onMutate: async ({ widgets }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<OverviewLayout>(queryKey);
      if (widgets && previous)
        queryClient.setQueryData<OverviewLayout>(queryKey, { ...previous, widgets });
      return { previous };
    },
    onSuccess: (layout) => queryClient.setQueryData(queryKey, layout),
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
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
