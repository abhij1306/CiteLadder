'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  integrationsApi,
  type IntegrationConnection,
  type IntegrationProperty,
  type IntegrationPropertyMapping,
  type IntegrationProvider,
} from '@/lib/api/integrations';
import { queryKeys } from '@/lib/api/query-keys';
import { isGrantGone } from '@/components/settings/grant-model';

/**
 * Where one data source stands for the active project, and so what the user
 * does next. Distinct states, never a percentage:
 *
 * - `connect`: no usable grant (none yet, or one that was disconnected).
 * - `reconnect`: a grant exists but the provider refused it.
 * - `choose`: connected, but no property imports into this project.
 * - `ready`: a property imports into this project.
 */
export type SourceStep =
  | { kind: 'connect' }
  | { kind: 'reconnect'; connection: IntegrationConnection }
  | { kind: 'choose'; connection: IntegrationConnection }
  | { kind: 'ready'; connection: IntegrationConnection; mapping: IntegrationPropertyMapping };

function sourceStep(
  provider: IntegrationProvider,
  connections: readonly IntegrationConnection[],
  mappings: ReadonlyMap<string, readonly IntegrationPropertyMapping[]>,
  projectId: string,
): SourceStep {
  const connection = connections.find((item) => item.provider === provider);
  if (!connection || isGrantGone(connection.grant_status)) return { kind: 'connect' };
  if (connection.grant_status !== 'connected') return { kind: 'reconnect', connection };
  const mapping = activeMappingFor(mappings.get(connection.id), projectId);
  return mapping ? { kind: 'ready', connection, mapping } : { kind: 'choose', connection };
}

/** A connection's mappings; one cache entry shared by Settings and the setup panel. */
export function mappingsQuery(connectionId: string, workspaceId: string | null) {
  return {
    queryKey: queryKeys.integrations.mappings(connectionId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      integrationsApi.listMappings(connectionId, { signal, workspaceId }),
    staleTime: 60 * 1000,
  };
}

/** A connection can serve several projects; only this project's active mapping counts. */
export function activeMappingFor(
  mappings: readonly IntegrationPropertyMapping[] | undefined,
  projectId: string | null,
): IntegrationPropertyMapping | null {
  return (
    mappings?.find((item) => item.status === 'active' && item.project_id === projectId) ?? null
  );
}

/** The project's own properties first, otherwise in the provider's order. */
export function ownPropertiesFirst(properties: readonly IntegrationProperty[]) {
  return [...properties].sort(
    (a, b) => Number(b.matches_project === true) - Number(a.matches_project === true),
  );
}

/** The steps for `providers` in the active project, from the connection and mapping reads. */
export function useDataSources(
  workspaceId: string | null,
  projectId: string | null,
  providers: readonly IntegrationProvider[],
) {
  const connections = useQuery({
    queryKey: queryKeys.integrations.connections(workspaceId),
    queryFn: ({ signal }) => integrationsApi.list({ signal, workspaceId }),
    enabled: Boolean(workspaceId),
  });
  // Only the connection each step reads, and only while its grant is connected.
  const relevant = providers.flatMap((provider) => {
    const connection = connections.data?.find((item) => item.provider === provider);
    return connection?.grant_status === 'connected' ? [connection] : [];
  });
  const mappingQueries = useQueries({
    queries: relevant.map((connection) => mappingsQuery(connection.id, workspaceId)),
  });
  const mappings = new Map(
    relevant.map((connection, index) => [connection.id, mappingQueries[index]?.data ?? []]),
  );
  const loading =
    connections.isLoading || mappingQueries.some((query) => query.isLoading && !query.data);
  const steps = new Map(
    providers.map((provider) => [
      provider,
      projectId
        ? sourceStep(provider, connections.data ?? [], mappings, projectId)
        : ({ kind: 'connect' } as SourceStep),
    ]),
  );
  return {
    loading,
    error: connections.isError ? connections.error : null,
    retry: () => void connections.refetch(),
    steps,
  };
}

/**
 * Everything a new property changes: its own mapping, readiness and the
 * projections it feeds. Refreshed at once rather than after the stale time, so
 * the page shows the import starting instead of the old empty state.
 */
export function useRefreshAfterMapping() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        [
          queryKeys.integrations.all,
          queryKeys.performance.all,
          queryKeys.demand.all,
          queryKeys.aiTraffic.all,
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
    [queryClient],
  );
}

/** Messages for the OAuth callback's `error=` codes; never the raw code. */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_exchange_failed: 'The consent screen was cancelled or did not finish. Try again.',
  oauth_state_invalid:
    'The connect link expired or was opened in a different browser. Start again from here.',
  oauth_not_configured: 'This connection is not available right now. Contact support.',
};

export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? 'The connection could not be completed. Try again.';
}
