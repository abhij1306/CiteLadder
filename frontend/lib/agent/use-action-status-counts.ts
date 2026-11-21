import { useQuery } from '@tanstack/react-query';

import { actionsQueries } from '@/lib/api/actions';
import { useProjectContext } from '@/lib/project/project-context';

type StatusCounts = Partial<Record<string, number>>;

export function queueCount(counts: StatusCounts): number {
  return (counts.open ?? 0) + (counts.in_progress ?? 0);
}

export function useActionStatusCounts(): { counts?: StatusCounts; pending: boolean } {
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const query = useQuery({
    ...actionsQueries.list({ workspaceId: activeWorkspaceId, projectId: activeProjectId ?? '' }),
    enabled: Boolean(activeWorkspaceId && activeProjectId),
  });
  return { counts: query.data?.status_counts, pending: query.isLoading };
}
