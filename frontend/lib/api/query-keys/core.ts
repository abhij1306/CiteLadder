/** Auth + workspaces + projects + prompts + providers + content query-key namespaces. */

export const authKeys = {
  all: ['auth'] as const,
  me: () => ['auth', 'me'] as const,
};

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: () => ['workspaces', 'list'] as const,
};

export const projectKeys = {
  all: ['projects'] as const,
  /**
   * Prefix over every workspace's project list. Use it to INVALIDATE from a
   * caller that has no workspace in hand; never as a query key.
   */
  lists: () => ['projects', 'list'] as const,
  /**
   * One workspace's projects.
   *
   * The workspace is part of the key because the response IS workspace-scoped
   * — the backend reads `X-Workspace-Id` to decide what to return. Keyed
   * without it, two workspaces shared one cache entry, so switching workspace
   * showed the previous one's projects until a refetch landed, and a request
   * issued for workspace A could be answered from B's payload.
   */
  list: (workspaceId: string) => ['projects', 'list', workspaceId] as const,
  detail: (projectId: string) => ['projects', 'detail', projectId] as const,
  commandCenter: (projectId: string) => ['projects', 'command-center', projectId] as const,
  overviewLayout: (projectId: string) => ['projects', 'overview-layout', projectId] as const,
  brandProfile: (projectId: string) => ['projects', 'brand-profile', projectId] as const,
  businessMap: (projectId: string) => ['projects', 'business-map', projectId] as const,
  brandFacts: (projectId: string) => ['projects', 'brand-facts', projectId] as const,
  markets: (projectId: string) => ['projects', 'markets', projectId] as const,
};

export const promptKeys = {
  all: ['prompts'] as const,
  sets: (projectId: string) => ['prompts', 'sets', projectId] as const,
  set: (promptSetId: string) => ['prompts', 'set', promptSetId] as const,
  list: (promptSetId: string) => ['prompts', 'list', promptSetId] as const,
  candidates: (promptSetId: string) => ['prompts', 'candidates', promptSetId] as const,
};

export const topicKeys = {
  all: ['topics'] as const,
  list: (projectId: string) => ['topics', 'list', projectId] as const,
  // Seed queries bind to topics, so a topic change refreshes them under `all`.
  seedQueries: (projectId: string) => ['topics', 'seed-queries', projectId] as const,
};

export const providerKeys = {
  all: ['providers'] as const,
  // Prefixes for workspace-agnostic invalidation (never query keys).
  allConnections: () => ['providers', 'connections'] as const,
  allStates: () => ['providers', 'states'] as const,
  // A workspace owns its provider connections, so the workspace is part of the
  // key for the same reason it is part of the project list's.
  connections: (workspaceId: string) => ['providers', 'connections', workspaceId] as const,
  connection: (connectionId: string) => ['providers', 'connection', connectionId] as const,
  catalog: () => ['providers', 'catalog'] as const,
  // The authenticated workspace projection — distinct from the public catalog.
  states: (workspaceId: string) => ['providers', 'states', workspaceId] as const,
};
export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: (workspaceId: string) => ['api-keys', workspaceId] as const,
};
