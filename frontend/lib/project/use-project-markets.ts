'use client';

import { useQuery } from '@tanstack/react-query';

import type { ProjectMarket } from '@citeladder/contracts/markets';

import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';

const NONE: readonly ProjectMarket[] = [];

/** The project's measurement markets, its default first; empty until loaded. */
export function useProjectMarkets(
  projectId: string,
  workspaceId: string | null,
  enabled = true,
): readonly ProjectMarket[] {
  const query = useQuery({
    queryKey: queryKeys.projects.markets(projectId),
    queryFn: ({ signal }) => projectsApi.listMarkets(projectId, { signal, workspaceId }),
    enabled: enabled && Boolean(projectId && workspaceId),
  });
  return query.data ?? NONE;
}
