/**
 * Integrations query-key namespace — connections are a flat
 * workspace-scoped route (scoped by the `X-Workspace-Id` header), so the
 * workspace id participates in the connections key;
 * sync runs are isolated per connection.
 */
export const integrationKeys = {
  all: ['integrations'] as const,
  connections: (workspaceId: string | null) =>
    ['integrations', 'connections', workspaceId ?? 'default'] as const,
  // The history-import rollup, polled only while windows drain.
  backfillProgress: (connectionId: string) =>
    ['integrations', 'backfill-progress', connectionId] as const,
  sync: (connectionId: string, syncId: string) =>
    ['integrations', 'sync', connectionId, syncId] as const,
  mappings: (connectionId: string) => ['integrations', 'mappings', connectionId] as const,
};
