import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { CommerceCatalog, CommerceProjection } from '@citeladder/contracts/commerce-suite';
import { commerceQueries, refreshCatalog } from '@/lib/api/commerce';
import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

export function useCatalogProjection(
  projectId: string,
  catalog: Pick<UseQueryResult<CommerceCatalog>, 'data' | 'dataUpdatedAt'>,
): CommerceProjection | undefined {
  const workspaceId = useActiveWorkspaceId();
  const client = useQueryClient();
  const catalogInFlight = Boolean(catalog.data?.projection.in_flight);
  const poll = useQuery({
    ...commerceQueries.catalogProjection({ workspaceId, projectId }),
    enabled: catalogInFlight,
    refetchInterval: ACTIVE_RUN_POLL_MS,
  });
  // A poll only runs once the catalog is cached, so one landing in the same
  // millisecond is still the later read.
  const newer = poll.data !== undefined && poll.dataUpdatedAt >= catalog.dataUpdatedAt;
  const terminalized = catalogInFlight && newer && poll.data?.in_flight === 0;
  const pollReadAt = poll.dataUpdatedAt;
  useEffect(() => {
    if (terminalized) void refreshCatalog(client, projectId, { joinInFlight: true });
  }, [terminalized, pollReadAt, client, projectId]);
  return newer ? poll.data : catalog.data?.projection;
}
