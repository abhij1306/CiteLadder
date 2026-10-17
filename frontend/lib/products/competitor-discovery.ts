'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { commerceApi } from '@/lib/api/commerce';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommerceTarget, CompetitorDiscoveryTask } from '@citeladder/contracts/commerce-suite';
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

/**
 * True when some discovery finished since the previous read, so its
 * candidates are worth fetching now rather than when every run is done.
 *
 * A tracked task that is terminal now and was not before (or was not read
 * yet) has finished. The reload path reads only what is still in flight, so
 * there a task that drops off the list has finished.
 */
export function discoveryFinished(previous: Tasks | undefined, next: Tasks): boolean {
  const before = new Map((previous ?? []).map((task) => [task.id, task.terminal]));
  if (next.some((task) => task.terminal && before.get(task.id) !== true)) return true;
  const present = new Set(next.map((task) => task.id));
  return [...before].some(([id, terminal]) => !terminal && !present.has(id));
}

/** Track competitor discovery for one project, from launch to terminal state. */
export function useCompetitorDiscovery(projectId: string) {
  const client = useQueryClient();
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
  const queryKey = trackedIds.length
    ? queryKeys.commerce.discoveryTasks(projectId, trackedIds)
    : queryKeys.commerce.activeDiscoveries(projectId);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<CompetitorDiscoveryTask[]>(queryKey);
      const next = await commerceApi.competitorDiscoveries(
        projectId,
        trackedIds.length ? trackedIds : undefined,
        { signal, workspaceId },
      );
      if (discoveryFinished(previous, next)) {
        void client.invalidateQueries({ queryKey: queryKeys.commerce.competitors(projectId) });
      }
      return next;
    },
    refetchInterval: (result) => discoveryPollInterval(result.state.data),
  });
  const discover = useMutation({
    mutationFn: (targets: CommerceTarget[]) =>
      commerceApi.discoverCompetitors(projectId, targets, { workspaceId }),
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
