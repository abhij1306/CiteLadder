/**
 * The one project guard for a project ID the request path did not authorize:
 * a body or query field, an API key's path, a worker or an MCP tool. Browser
 * routes under `/projects/{project_id}` declare `authorize: 'active-project'`
 * (or `'project'`) instead, which resolves membership and project in the
 * session read; the services they call do not check it again.
 *
 * A project outside the workspace is indistinguishable from a missing one:
 * both are `Project not found` (invariant: workspace-authorized reads).
 */
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { notFound } from '../errors.ts';

export async function requireProject(
  db: Database,
  scope: { workspaceId: string; projectId: string },
): Promise<void> {
  const project = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
}
