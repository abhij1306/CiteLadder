import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { opportunitiesApi } from '@/lib/api/opportunities';
import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommandCenter, Opportunity, Project } from '@/lib/api/types';
import { saveBlob } from '@/lib/download';

export function useCommandCenterActions(data: CommandCenter, project: Project) {
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const orderVersion = useRef(data.action_order_version);
  const queryKey = queryKeys.projects.commandCenter(project.id);
  const reorder = useMutation({
    mutationFn: (ordered: Opportunity[]) =>
      opportunitiesApi.updateOrder(
        project.id,
        {
          ordered_opportunity_ids: ordered.map((row) => row.id),
          expected_version: orderVersion.current,
        },
        { workspaceId: project.workspace_id },
      ),
    onMutate: async (ordered) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CommandCenter>(queryKey);
      queryClient.setQueryData<CommandCenter>(queryKey, (current) =>
        current ? { ...current, actions: ordered } : current,
      );
      return { previous };
    },
    onSuccess: (result) => {
      orderVersion.current = result.version;
    },
    onError: (_error, _ordered, context) => {
      orderVersion.current = data.action_order_version;
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  useEffect(() => {
    orderVersion.current = data.action_order_version;
  }, [data.action_order_version]);
  return {
    actions: data.actions,
    downloadError,
    downloading,
    reorderError: reorder.isError,
    reorderPending: reorder.isPending,
    move: (from: number, to: number) =>
      moveActions(from, to, data.actions, reorder.isPending, reorder),
    download: () => downloadReport(project, setDownloading, setDownloadError),
  };
}

function moveActions(
  from: number,
  to: number,
  actions: Opportunity[],
  pending: boolean,
  reorder: { mutate: (actions: Opportunity[]) => void },
) {
  if (
    pending ||
    from < 0 ||
    to < 0 ||
    from >= actions.length ||
    to >= actions.length ||
    from === to
  )
    return;
  const next = [...actions];
  const [item] = next.splice(from, 1);
  if (!item) return;
  next.splice(to, 0, item);
  reorder.mutate(next);
}

async function downloadReport(
  project: Project,
  setDownloading: (value: boolean) => void,
  setError: (value: boolean) => void,
) {
  setDownloading(true);
  setError(false);
  try {
    const blob = await projectsApi.downloadOverviewReport(project.id, {
      workspaceId: project.workspace_id,
    });
    saveBlob(blob, `citeladder-${project.brand_name || project.name}-overview.pdf`);
  } catch {
    setError(true);
  } finally {
    setDownloading(false);
  }
}
