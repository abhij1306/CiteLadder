'use client';

import { useQuery } from '@tanstack/react-query';

import { projectsApi } from '@/lib/api/projects';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The project's brand facts and whether the workspace is in the fact-checking
 * pilot. One cache entry serves the Context panel and the Accuracy tab gate.
 */
export function useBrandFacts(projectId: string | null, workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.projects.brandFacts(projectId ?? ''),
    queryFn: ({ signal }) => projectsApi.getBrandFacts(projectId!, { signal, workspaceId }),
    enabled: Boolean(projectId && workspaceId),
  });
}
