'use client';

import { useQuery } from '@tanstack/react-query';

import { projectQueries } from '@/lib/api/projects';

/**
 * The project's brand facts and whether the workspace is in the fact-checking
 * pilot. One cache entry serves the Context panel and the Accuracy tab gate.
 */
export function useBrandFacts(projectId: string | null, workspaceId: string | null) {
  return useQuery({
    // Disabled until both are known, so the empty id never reaches the API.
    ...projectQueries.brandFacts(workspaceId, projectId ?? ''),
    enabled: Boolean(projectId && workspaceId),
  });
}
