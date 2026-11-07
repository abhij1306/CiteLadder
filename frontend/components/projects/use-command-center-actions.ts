import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { projectMutations, projectsApi } from '@/lib/api/projects';
import type { CommandCenter, Opportunity, Project } from '@citeladder/contracts';
import { saveBlob } from '@/lib/download';

export function useCommandCenterActions(data: CommandCenter, project: Project) {
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const orderVersion = useRef(data.action_order_version);
  const reorder = useMutation(
    projectMutations.reorderActions({ workspaceId: project.workspace_id, projectId: project.id }),
  );
  // The version the next reorder names: the one a reorder returned, or, after
  // a refusal, the one the command center was read with.
  const reorderTo = (ordered: Opportunity[]) =>
    reorder.mutate(
      { ordered, expectedVersion: orderVersion.current },
      {
        onSuccess: (result) => {
          orderVersion.current = result.version;
        },
        onError: () => {
          orderVersion.current = data.action_order_version;
        },
      },
    );
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
      moveActions(from, to, data.actions, reorder.isPending, reorderTo),
    download: () => downloadReport(project, setDownloading, setDownloadError),
  };
}

function moveActions(
  from: number,
  to: number,
  actions: Opportunity[],
  pending: boolean,
  reorder: (actions: Opportunity[]) => void,
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
  reorder(next);
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
