import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { providersApi } from '@/lib/api/providers';
import { queryKeys } from '@/lib/api/query-keys';
import type { LogicalEngine } from '@citeladder/contracts';
import { isConfigured, isVerified } from '@/lib/providers/catalog';
import { useEngineCatalog } from '@/lib/providers/engines';

/**
 * The engines an audit can measure, from the workspace's own provider routes:
 * `configuredEngines` passed a connection test, `unverifiedEngines` hold a key
 * that has not passed one yet. Both follow the catalogue's display `order`.
 */
export function engineAvailability(
  order: readonly LogicalEngine[],
  connections: Awaited<ReturnType<typeof providersApi.listConnections>> | undefined,
) {
  const verified = new Set<LogicalEngine>();
  const stored = new Set<LogicalEngine>();
  for (const connection of connections ?? []) {
    if (!connection.active) continue;
    if (!isConfigured(connection)) continue;
    const target = isVerified(connection) ? verified : stored;
    for (const route of connection.routes ?? []) {
      if (route.active !== false) target.add(route.logical_engine);
    }
  }
  return {
    configuredEngines: order.filter((engine) => verified.has(engine)),
    unverifiedEngines: order.filter((engine) => stored.has(engine) && !verified.has(engine)),
  };
}

/** Launches and schedules offer only the engines the workspace can actually run. */
export function useConfiguredEngines(enabled: boolean, workspaceId: string | null) {
  const connectionsQuery = useQuery({
    queryKey: queryKeys.providers.connections(workspaceId ?? 'unresolved'),
    queryFn: ({ signal }) => providersApi.listConnections({ signal, workspaceId }),
    enabled: enabled && workspaceId !== null,
  });
  const catalog = useEngineCatalog();
  const engines = useMemo(
    () => engineAvailability(catalog.order, connectionsQuery.data),
    [catalog.order, connectionsQuery.data],
  );
  return {
    ...engines,
    catalog,
    enginesReady: catalog.order.length > 0 && connectionsQuery.isSuccess,
  };
}
