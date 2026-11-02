import { resolveWorkspaceMember } from '../auth/workspace.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { AgentError, type Scope } from './contracts.ts';

/**
 * Re-check, from the executor it is given, that the user is still active, still
 * a member and the project still in the workspace (and, for `write`, may run).
 * Request reads never call it: the route's session read authorized them. It
 * remains for work that outlives that read or must hold inside a transaction:
 * admission and output writes, so a revocation that commits first refuses
 * them; and each step of a long-running turn, its tools and its model calls,
 * so access removed mid-turn stops it.
 */
export async function authorize(db: Database, scope: Scope, write = true) {
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('id', '=', scope.userId)
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!user) throw notFound('Project');
  const member = await resolveWorkspaceMember(db, scope.userId, scope.workspaceId);
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  if (write && !member.allows('run')) throw new AgentError('access_revoked');
}
