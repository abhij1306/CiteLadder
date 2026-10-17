/** Atomic Commerce suite query-key namespace. */
export const commerceKeys = {
  all: ['commerce'] as const,
  catalog: (projectId: string) => ['commerce', projectId, 'catalog'] as const,
  competitors: (projectId: string) => ['commerce', projectId, 'competitors'] as const,
  buyerPrompts: (projectId: string) => ['commerce', projectId, 'buyer-prompts'] as const,
  discoveryTasks: (projectId: string, taskIds: string[]) =>
    ['commerce', projectId, 'competitor-discoveries', ...taskIds] as const,
  /** Whatever discovery is in flight for the project, per the server. */
  activeDiscoveries: (projectId: string) =>
    ['commerce', projectId, 'competitor-discoveries', 'active'] as const,
  shelf: (projectId: string, target?: { kind: string; id: string }) =>
    [
      'commerce',
      projectId,
      'ai-shelf',
      target?.kind ?? 'no-target',
      target?.id ?? 'no-target',
    ] as const,
};
