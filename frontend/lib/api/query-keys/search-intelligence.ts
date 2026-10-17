export const searchIntelligenceKeys = {
  all: ['search-intelligence'] as const,
  readiness: (workspaceId: string | null | undefined, projectId: string | null | undefined) =>
    ['search-intelligence', workspaceId, projectId, 'readiness'] as const,
  runs: (workspaceId: string | null | undefined, projectId: string | null | undefined) =>
    ['search-intelligence', workspaceId, projectId, 'runs'] as const,
  dataset: (
    workspaceId: string | null | undefined,
    projectId: string | null | undefined,
    datasetId: string | null | undefined,
  ) => ['search-intelligence', workspaceId, projectId, 'dataset', datasetId] as const,
};
