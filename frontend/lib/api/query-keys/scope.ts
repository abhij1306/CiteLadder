export type ProjectScope = Readonly<{ workspaceId: string | null; projectId: string }>;

export function scopedKeys<const Domain extends string>(domain: Domain) {
  return {
    all: [domain] as const,
    project: (projectId: string) => [domain, projectId] as const,
    resource: <const Resource extends string>(projectId: string, resource: Resource) =>
      [domain, projectId, resource] as const,
    read: <const Resource extends string, const Args extends readonly unknown[]>(
      resource: Resource,
      scope: ProjectScope,
      ...args: Args
    ) => [domain, scope.projectId, resource, scope.workspaceId, ...args] as const,
  };
}
