'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { commerceMutations, commerceQueries } from '@/lib/api/commerce';
import type { CompetitorDiscoveryTask } from '@citeladder/contracts/commerce-suite';
import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

type Tasks = readonly CompetitorDiscoveryTask[];

/**
 * How often to re-read discovery tasks, or `false` once none are running.
 *
 * Pure and exported so the rule is testable without mounting the panel.
 */
export function discoveryPollInterval(tasks: Tasks | undefined): number | false {
  return (tasks ?? []).some((task) => !task.terminal) ? ACTIVE_RUN_POLL_MS : false;
}

/** Track competitor discovery for one project, from launch to terminal state. */
export function useCompetitorDiscovery(projectId: string) {
  const workspaceId = useActiveWorkspaceId();
  // Every id this screen launched, so a second discovery does not drop the
  // first one's progress. They do not survive a reload, so an empty set falls
  // back to asking the server what is still in flight — the only form reload
  // recovery can take.
  // Keyed by project, so switching projects never polls another project's IDs.
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
