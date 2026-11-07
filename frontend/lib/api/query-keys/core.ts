/** Auth + workspaces + projects + prompts + providers + content query-key namespaces. */
import { scopedKeys, type ProjectScope } from './scope';

export const authKeys = {
  all: ['auth'] as const,
  me: () => ['auth', 'me'] as const,
};

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: () => ['workspaces', 'list'] as const,
};

/**
 * Reads that serve access recovery: the session, the memberships and each
 * workspace's access. A workspace without access keeps these and drops the rest.
 */
export function isAccessRecoveryKey(key: readonly unknown[]): boolean {
  const [domain, resource] = key;
  return (
    domain === 'auth' || (domain === 'workspaces' && (resource === 'list' || resource === 'access'))
  );
}

const projects = scopedKeys('projects');
/**
 * The project shell's own reads (`list`, `detail`) are keyed outside the
 * scoped shape: the list is one workspace's, and the detail is authorized
 * from its path before any workspace is known. A project's resources use the
 * scoped shape, so `project(projectId)` refreshes them all (but not the list
 * or the detail), and `all` covers every one.
 */
export const projectKeys = {
  ...projects,
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
  /** Whether a key is a project's detail read (the read that resolves the project itself). */
  isDetail: (key: readonly unknown[]) => key[0] === 'projects' && key[1] === 'detail',
  commandCenter: (scope: ProjectScope) => projects.read('command-center', scope),
  overviewLayout: (scope: ProjectScope) => projects.read('overview-layout', scope),
  brandProfile: (scope: ProjectScope) => projects.read('brand-profile', scope),
  businessMap: (scope: ProjectScope) => projects.read('business-map', scope),
  brandFacts: (scope: ProjectScope) => projects.read('brand-facts', scope),
  markets: (scope: ProjectScope) => projects.read('markets', scope),
};

const prompts = scopedKeys('prompts');
export const promptKeys = {
  ...prompts,
  /** The project's prompt sets, with their prompts. */
  sets: (scope: ProjectScope) => prompts.read('sets', scope),
  /** One set's pending generated candidates; `null` before the project has a set. */
  candidates: (scope: ProjectScope, promptSetId: string | null) =>
    prompts.read('candidates', scope, promptSetId),
};

const topics = scopedKeys('topics');
export const topicKeys = {
  ...topics,
  list: (scope: ProjectScope) => topics.read('list', scope),
  // Seed queries bind to topics, so a topic change refreshes them under `project`.
  seedQueries: (scope: ProjectScope) => topics.read('seed-queries', scope),
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
