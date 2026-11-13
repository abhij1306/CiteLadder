import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { CommerceCatalog, CommerceProjection } from '@citeladder/contracts/commerce-suite';
import { commerceQueries, refreshCatalog } from '@/lib/api/commerce';
import { ACTIVE_RUN_POLL_MS } from '@/lib/config/operational';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

/**
 * The catalog's projection progress, polled alone while projections run.
 *
 * Re-reading the whole catalog every few seconds to learn one count moved
 * every product on each tick. Instead, while the cached catalog says work is
 * in flight, only the projection state is polled, and the catalog is read
 * again once, when a projection read newer than it reports nothing in flight.
 * A catalog read after that which still shows work in flight starts the poll
 * again; one showing none stops it. If that catalog read fails, the catalog
 * keeps its in-flight copy, so the poll keeps running and each newer poll asks
 * for the catalog again (joining a read already under way rather than
 * restarting it) while the catalog's own error state shows the failure.
 *
 * Returns the newest projection known: the poll's when it is newer than the
 * catalog, else the catalog's own.
 */
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
