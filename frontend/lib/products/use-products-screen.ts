'use client';

import { useQuery } from '@tanstack/react-query';

import { commerceApi } from '@/lib/api/commerce';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { catalogPollingInterval } from './catalog-polling';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * Every Commerce read for the workspace, gated on the selected target rather
 * than on which tab is open.
 *
 * The tab argument is gone with the tabs: competitors, prompts, and shelf were
 * each fetched only while their own tab was mounted, which is why selecting a
 * target in one view told the others nothing. The catalog is always loaded (it
 * is the navigation), and the three target-scoped reads follow the selection.
 */
export function useCommerceQueries(projectId: string, target?: CommerceTarget) {
  const workspaceId = useActiveWorkspaceId();
  const hasProject = Boolean(projectId);
  const catalog = useQuery({
    queryKey: queryKeys.commerce.catalog(projectId),
    queryFn: ({ signal }) => commerceApi.catalog(projectId, { signal, workspaceId }),
    enabled: hasProject,
    refetchInterval: (query) => catalogPollingInterval(query.state.data?.projection),
  });
  const competitors = useQuery({
    queryKey: queryKeys.commerce.competitors(projectId),
    queryFn: ({ signal }) => commerceApi.competitors(projectId, { signal, workspaceId }),
    // No interval: the discovery tracker owns the in-flight signal and
    // invalidates this list when the last tracked run terminalizes.
    enabled: hasProject,
  });
  const buyerPrompts = useQuery({
    queryKey: queryKeys.commerce.buyerPrompts(projectId),
    queryFn: ({ signal }) => commerceApi.buyerPrompts(projectId, { signal, workspaceId }),
    enabled: hasProject,
  });
  const shelf = useQuery({
    queryKey: queryKeys.commerce.shelf(projectId, target),
    queryFn: ({ signal }) => commerceApi.shelf(projectId, target!, { signal, workspaceId }),
    enabled: hasProject && Boolean(target),
  });
  return { catalog, competitors, buyerPrompts, shelf };
}
