import { scopedKeys, type ProjectScope } from './scope';

export const authKeys = {
  all: ['auth'] as const,
  me: () => ['auth', 'me'] as const,
};

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: () => ['workspaces', 'list'] as const,
};

export function isAccessRecoveryKey(key: readonly unknown[]): boolean {
  const [domain, resource] = key;
  return (
    domain === 'auth' || (domain === 'workspaces' && (resource === 'list' || resource === 'access'))
  );
}

const projects = scopedKeys('projects');
export const projectKeys = {
  ...projects,
  summaries: (workspaceId: string) => ['projects', 'summaries', workspaceId] as const,
  detail: (projectId: string) => ['projects', 'detail', projectId] as const,
  isDetail: (key: readonly unknown[]) => key[0] === 'projects' && key[1] === 'detail',
  commandCenter: (scope: ProjectScope) => projects.read('command-center', scope),
  overviewLayout: (scope: ProjectScope) => projects.read('overview-layout', scope),
  brandProfile: (scope: ProjectScope) => projects.read('brand-profile', scope),
  businessMap: (scope: ProjectScope) => projects.read('business-map', scope),
  brandFacts: (scope: ProjectScope) => projects.read('brand-facts', scope),
  themes: (scope: ProjectScope) => projects.read('themes', scope),
  probes: (scope: ProjectScope) => projects.read('probes', scope),
  probeRead: (scope: ProjectScope, view: 'market' | 'objections', basis: string) =>
    projects.read('probes', scope, view, basis),
  markets: (scope: ProjectScope) => projects.read('markets', scope),
};

const prompts = scopedKeys('prompts');
export const promptKeys = {
  ...prompts,
  sets: (scope: ProjectScope) => prompts.read('sets', scope),
  candidates: (scope: ProjectScope, promptSetId: string | null) =>
    prompts.read('candidates', scope, promptSetId),
  generate: (scope: ProjectScope) => prompts.read('generate', scope),
};

const topics = scopedKeys('topics');
export const topicKeys = {
  ...topics,
  list: (scope: ProjectScope) => topics.read('list', scope),
  seedQueries: (scope: ProjectScope) => topics.read('seed-queries', scope),
};

export const providerKeys = {
  all: ['providers'] as const,
  allConnections: () => ['providers', 'connections'] as const,
  allStates: () => ['providers', 'states'] as const,
  connections: (workspaceId: string) => ['providers', 'connections', workspaceId] as const,
  connection: (connectionId: string) => ['providers', 'connection', connectionId] as const,
  catalog: () => ['providers', 'catalog'] as const,
  states: (workspaceId: string) => ['providers', 'states', workspaceId] as const,
};
export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: (workspaceId: string) => ['api-keys', workspaceId] as const,
};
