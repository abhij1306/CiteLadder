'use client';

import { useQuery } from '@tanstack/react-query';

import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { providersApi } from '@/lib/api/providers';
import { queryKeys } from '@/lib/api/query-keys';
import type { LogicalEngine } from '@/lib/api/types';
import { buildEngineCards, buildProviderGroups, transportForEngine } from '@/lib/providers/catalog';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

import { ProviderRow } from './provider-row';

/**
 * The workspace's BYOK credentials, one row per provider. Shared by Settings
 * and the launch dialog's inline setup so both connect the same way.
 *
 * Rows are driven by `/provider-catalog`: a transport appears once, with every
 * engine it measures, so one DataForSEO login covers all its surfaces.
 * `expandEngine` opens the row that measures that engine on arrival (the
 * launch dialog's clicked engine chip).
 */
export function ProviderList({
  expandEngine = null,
}: Readonly<{ expandEngine?: LogicalEngine | null }>) {
  const catalogQuery = useQuery({
    queryKey: queryKeys.providers.catalog(),
    queryFn: ({ signal }) => providersApi.getCatalog({ signal, workspaceId: null }),
  });

  // Provider connections belong to the workspace, so the read is keyed and
  // sent for one: without that, switching workspace showed the previous
  // workspace's engines as configured.
  const workspaceId = useActiveWorkspaceId();
  const connectionsQuery = useQuery({
    queryKey: queryKeys.providers.connections(workspaceId ?? 'unresolved'),
    queryFn: ({ signal }) => providersApi.listConnections({ signal, workspaceId }),
    enabled: workspaceId !== null,
  });

  // The AUTHENTICATED state projection. A failure here leaves every row at its
  // fail-closed default rather than implying `connected`.
  const statesQuery = useQuery({
    queryKey: queryKeys.providers.states(workspaceId ?? 'unresolved'),
    queryFn: ({ signal }) => providersApi.getConnectionStates({ signal, workspaceId }),
    enabled: workspaceId !== null,
  });

  if (catalogQuery.isError || connectionsQuery.isError) {
    return (
      <ReadError
        error={catalogQuery.error ?? connectionsQuery.error}
        fallback="Could not load providers. Check your connection and try again."
        onRetry={() => {
          if (catalogQuery.isError) void catalogQuery.refetch();
          if (connectionsQuery.isError) void connectionsQuery.refetch();
        }}
        pending={catalogQuery.isFetching || connectionsQuery.isFetching}
      />
    );
  }
  if (catalogQuery.isLoading || connectionsQuery.isLoading) {
    return (
      <div className="grid gap-4" aria-busy="true">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const groups = buildProviderGroups(
    buildEngineCards(catalogQuery.data, statesQuery.data?.providers),
  );
  const connections = connectionsQuery.data ?? [];
  const expand = expandEngine ? transportForEngine(groups, expandEngine) : null;
  return (
    <ul className="divide-border grid divide-y">
      {groups.map((group) => (
        <ProviderRow
          key={group.transport}
          group={group}
          connections={connections}
          defaultOpen={group.transport === expand}
        />
      ))}
    </ul>
  );
}
