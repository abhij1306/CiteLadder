'use client';

import { useQuery } from '@tanstack/react-query';

import type { ProjectMarket } from '@citeladder/contracts/markets';

import { projectQueries } from '@/lib/api/projects';

const NONE: readonly ProjectMarket[] = [];

/** The project's measurement markets, its default first; empty until loaded. */
export function useProjectMarkets(
  projectId: string,
  workspaceId: string | null,
  enabled = true,
): readonly ProjectMarket[] {
  const query = useQuery({
    ...projectQueries.markets({ workspaceId, projectId }),
    enabled: enabled && Boolean(projectId && workspaceId),
  });
  return query.data ?? NONE;
}
