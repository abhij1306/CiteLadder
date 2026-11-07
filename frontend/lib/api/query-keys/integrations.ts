/**
 * Integrations query-key namespace. Connections are a flat workspace-scoped
 * route (scoped by the `X-Workspace-Id` header), so the
 * workspace participates in the connections key. A connection's own reads are
 * keyed by the connection, the workspace last, so one connection's prefix
 * reaches every workspace's copy.
 */
const connection = <const Resource extends string>(connectionId: string, resource: Resource) =>
  ['integrations', 'connection', connectionId, resource] as const;

export const integrationKeys = {
  all: ['integrations'] as const,
  connections: (workspaceId: string | null) =>
    ['integrations', 'connections', workspaceId] as const,
  // The history-import rollup, polled only while windows drain.
  backfillProgress: (workspaceId: string | null, connectionId: string) =>
    [...connection(connectionId, 'backfill-progress'), workspaceId] as const,
  sync: (workspaceId: string | null, connectionId: string, syncId: string) =>
    [...connection(connectionId, 'sync'), syncId, workspaceId] as const,
  mappings: (workspaceId: string | null, connectionId: string) =>
    [...connection(connectionId, 'mappings'), workspaceId] as const,
};
