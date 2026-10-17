import type { Selectable } from 'kysely';
import { workspaceSchema } from '@citeladder/contracts/auth';
import { z } from 'zod';
import {
  WorkspaceContext,
  resolveWorkspaceMember,
  type WorkspaceCapability,
} from '../auth/workspace.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { Users, Workspaces } from '../generated/db-schema.ts';

export type User = Selectable<Users>;
type Role = keyof typeof policy.workspaces.roles;
const isRole = (key: string): key is Role => Object.hasOwn(policy.workspaces.roles, key);
// Workspace policy names the roles used by the wire enum.
const [firstRole, ...otherRoles] = Object.keys(policy.workspaces.roles).filter(isRole);
if (!firstRole) throw new Error('Workspace policy names no roles.');
const roleSchema = z.enum([firstRole, ...otherRoles]);

export function workspaceView(
  workspace: Selectable<Workspaces>,
  role: string,
): z.input<typeof workspaceSchema> {
  return {
    id: workspace.id,
    name: workspace.name,
    role: roleSchema.parse(role),
    capabilities: [...new WorkspaceContext(workspace.id, role).capabilities()],
    created_at: workspace.created_at.toISOString(),
    updated_at: workspace.updated_at.toISOString(),
  };
}

/** Root lock orders workspace-scoped writes and rechecks live authority. */
export async function lockAuthorizedWorkspace(
  db: Database,
  workspaceId: string,
  userId: string,
  capability: WorkspaceCapability,
) {
  const workspace = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('id', '=', workspaceId)
    .where('is_system', '=', false)
    .forUpdate()
    .executeTakeFirst();
  if (!workspace) throw notFound('Workspace');
  (await resolveWorkspaceMember(db, userId, workspaceId)).require(capability);
  return workspace;
}
