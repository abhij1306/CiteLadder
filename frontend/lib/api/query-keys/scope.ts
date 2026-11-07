/**
 * The shared scoped-key builder (F4). A domain's project reads are keyed
 * `[domain, projectId, resource, workspaceId, ...args]`:
 *   - the workspace is part of every key because the response is that
 *     workspace's authorized read (`X-Workspace-Id`);
 *   - the project comes before the resource, so one `project(projectId)`
 *     prefix invalidates every read of the domain for that project, in every
 *     workspace, without listing resources.
 * Keys are built only here; callers never read a key by position.
 */

/** The workspace and project a read is authorized and cached under. */
export type ProjectScope = Readonly<{ workspaceId: string | null; projectId: string }>;

export function scopedKeys<const Domain extends string>(domain: Domain) {
  return {
    /** Every read of the domain, for a cache-wide reset. */
    all: [domain] as const,
    /** Every read of the domain for one project: the invalidation prefix. */
    project: (projectId: string) => [domain, projectId] as const,
    /** One workspace's read of a project resource. */
    read: <const Resource extends string, const Args extends readonly unknown[]>(
      resource: Resource,
      scope: ProjectScope,
      ...args: Args
    ) => [domain, scope.projectId, resource, scope.workspaceId, ...args] as const,
  };
}
