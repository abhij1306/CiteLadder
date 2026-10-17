/**
 * Project authorization through the active workspace.
 *
 * A project outside the caller's workspace is indistinguishable from a
 * missing one: both are `Project not found` (invariant: workspace-authorized
 * reads). A context already authorized through this project proved it.
 */
import type { WorkspaceContext } from '../auth/workspace.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';

export async function requireProject(
  db: Database,
  workspace: WorkspaceContext,
  projectId: string,
): Promise<void> {
  if (workspace.projectId === projectId) return;
  const project = await workspace.scope
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
}
