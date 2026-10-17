import { useQuery } from '@tanstack/react-query';

import { actionsQueries } from '@/lib/api/actions';
import { useProjectContext } from '@/lib/project/project-context';

type StatusCounts = Partial<Record<string, number>>;

/** The work queue: Actions that are open or in progress. */
export function queueCount(counts: StatusCounts): number {
  return (counts.open ?? 0) + (counts.in_progress ?? 0);
}

/**
 * Project-wide Action counts by status, from the unfiltered first page that
 * the navigation badge and the Actions filter share. Undefined until loaded.
 */
export function useActionStatusCounts(): StatusCounts | undefined {
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  return useQuery({
    ...actionsQueries.list(activeWorkspaceId ?? '', activeProjectId ?? ''),
    enabled: Boolean(activeWorkspaceId && activeProjectId),
  }).data?.status_counts;
}
