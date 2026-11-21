import { resolveWorkspaceMember } from '../auth/workspace.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { AgentError, type Scope } from './contracts.ts';

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
