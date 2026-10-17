/** Demand query keys shared by the projection and content workflow consumers. */
export const demandKeys = {
  all: ['demand'] as const,
  latest: (projectId: string | null | undefined) => ['demand', projectId, 'latest'] as const,
};
