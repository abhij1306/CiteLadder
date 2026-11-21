import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { commerceMutations, commerceQueries } from '@/lib/api/commerce';
import type { CompetitorDiscoveryTask } from '@citeladder/contracts/commerce-suite';
import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

type Tasks = readonly CompetitorDiscoveryTask[];

export function discoveryPollInterval(tasks: Tasks | undefined): number | false {
  return (tasks ?? []).some((task) => !task.terminal) ? ACTIVE_RUN_POLL_MS : false;
}

export function useCompetitorDiscovery(projectId: string) {
  const workspaceId = useActiveWorkspaceId();
  const [tracked, setTracked] = useState<{ projectId: string; ids: string[] }>({
    projectId,
    ids: [],
  });
  const trackedIds = tracked.projectId === projectId ? tracked.ids : [];
  const scope = { workspaceId, projectId };
  const query = useQuery({
    ...commerceQueries.discoveries(scope, trackedIds),
    refetchInterval: (result) => discoveryPollInterval(result.state.data),
  });
  const discover = useMutation({
    ...commerceMutations.discoverCompetitors(scope),
    onSuccess: (data) =>
      setTracked((current) => ({
        projectId,
        ids: [
          ...new Set([...(current.projectId === projectId ? current.ids : []), ...data.task_ids]),
        ],
      })),
  });

  return { tasks: query.data ?? [], discover };
}
