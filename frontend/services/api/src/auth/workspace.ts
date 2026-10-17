/**
 * Workspace membership and the role/capability matrix.
 *
 * Workspace config owns the matrix and refusal wording; a role
 * missing from it confers nothing (fail closed).
 * A non-member cannot tell an existing workspace from a missing one: both 404.
 */
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import type { MiddlewareHandler } from 'hono';

import { policy } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError, notFound } from '../errors.ts';
import { RequestValidationError, UUID_MESSAGE } from '../http/params.ts';
import { parseUuid } from '../http/uuid.ts';

export type WorkspaceCapability = keyof typeof policy.workspaces.denial_messages;

const ROLE_CAPABILITIES: Record<string, readonly string[]> = policy.workspaces.roles;
const FORBIDDEN_CODE = asApiErrorCode(policy.workspaces.forbidden_code);

function roleCapabilities(role: string): readonly string[] {
  return (Object.hasOwn(ROLE_CAPABILITIES, role) && ROLE_CAPABILITIES[role]) || [];
}

/** Whether a stored role permits `capability`; a role outside the matrix permits nothing. */
export function roleAllows(role: string, capability: WorkspaceCapability): boolean {
  return roleCapabilities(role).includes(capability);
}

/** Every role permitting `capability`, for membership filters written in SQL. */
export function rolesWith(capability: WorkspaceCapability): string[] {
  return Object.keys(ROLE_CAPABILITIES).filter((role) => roleAllows(role, capability));
}

export class WorkspaceContext {
  readonly scope: WorkspaceScope;
  readonly role: string;
  /** The project whose membership join resolved this context, when one did. */
  readonly projectId: string | null;

  constructor(workspaceId: string, role: string, projectId: string | null = null) {
    this.scope = new WorkspaceScope(workspaceId);
    this.role = role;
    this.projectId = projectId;
  }

  get workspaceId(): string {
    return this.scope.workspaceId;
  }

  allows(capability: WorkspaceCapability): boolean {
    return roleAllows(this.role, capability);
  }

  /** The caller's effective capability names for UI controls. */
  capabilities(): readonly string[] {
    return roleCapabilities(this.role);
  }

  /** 403 unless the caller's role permits `capability`. */
  require(capability: WorkspaceCapability): void {
    if (!this.allows(capability)) throw capabilityDenied(capability);
  }
}

/** The 403 a caller without `capability` receives. */
export function capabilityDenied(capability: WorkspaceCapability, message?: string): ApiError {
  return new ApiError(403, message ?? policy.workspaces.denial_messages[capability], {
    code: FORBIDDEN_CODE,
  });
}

/** The user's membership, if any; system workspaces never authorize. */
export async function findWorkspaceMember(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceContext | undefined> {
  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select(['workspace_members.workspace_id', 'workspace_members.role'])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_system', '=', false)
    .executeTakeFirst();
  return member && new WorkspaceContext(member.workspace_id, member.role);
}

/** The caller's membership, or 404. */
export async function resolveWorkspaceMember(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceContext> {
  const member = await findWorkspaceMember(db, userId, workspaceId);
  if (member === undefined) throw notFound('Workspace');
  return member;
}

/** A UUID path parameter, or the published 422 for `name`. */
export function pathUuid(raw: string | undefined, name: string): string {
  const id = parseUuid(raw ?? '');
  if (id === null)
    throw new RequestValidationError([
      { loc: [name], message: UUID_MESSAGE, type: 'uuid_parsing' },
    ]);
  return id;
}

/**
 * Authorize the path `:workspace_id` for the session user (mount after
 * `sessionUser`), optionally gated on one capability.
 */
export function workspaceMember(
  db: Database,
  capability?: WorkspaceCapability,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const workspaceId = pathUuid(c.req.param('workspace_id'), 'workspace_id');
    const workspace = await resolveWorkspaceMember(db, c.get('user').id, workspaceId);
    if (capability !== undefined) workspace.require(capability);
    c.set('workspace', workspace);
    await next();
  };
}

/**
 * Authorize through the project in the path (mount after `sessionUser`): the
 * caller must belong to the project's workspace. A missing project and a
 * foreign one are the same `Project not found`, and `X-Workspace-Id` is not read.
 */
export function projectMember(db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const projectId = pathUuid(c.req.param('project_id'), 'project_id');
    const member = await db
      .selectFrom('projects')
      .innerJoin('workspaces', 'workspaces.id', 'projects.workspace_id')
      .innerJoin('workspace_members', 'workspace_members.workspace_id', 'projects.workspace_id')
      .select(['workspace_members.workspace_id', 'workspace_members.role'])
      .where('projects.id', '=', projectId)
      .where('workspace_members.user_id', '=', c.get('user').id)
      .where('workspaces.is_system', '=', false)
      .executeTakeFirst();
    if (member === undefined) throw notFound('Project');
    c.set('workspace', new WorkspaceContext(member.workspace_id, member.role, projectId));
    await next();
  };
}

/** The caller's earliest tenant membership, or 404. */
async function defaultWorkspaceMember(db: Database, userId: string): Promise<WorkspaceContext> {
  const member = await db
    .selectFrom('workspace_members')
    .innerJoin('workspaces', 'workspaces.id', 'workspace_members.workspace_id')
    .select(['workspace_members.workspace_id', 'workspace_members.role'])
    .where('workspace_members.user_id', '=', userId)
    .where('workspaces.is_system', '=', false)
    .orderBy('workspace_members.created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (member === undefined) throw notFound('Workspace');
  return new WorkspaceContext(member.workspace_id, member.role);
}

/**
 * Resolve the active workspace for a flat route (mount after `sessionUser`):
 * the `X-Workspace-Id` header when the client selects one, otherwise the
 * caller's earliest tenant membership. Membership is verified either way, and a
 * foreign workspace is a 404.
 */
export function activeWorkspace(
  db: Database,
  capability?: WorkspaceCapability,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const selected = c.req.header('x-workspace-id');
    let workspace: WorkspaceContext;
    if (selected) {
      const workspaceId = parseUuid(selected);
      if (workspaceId === null) throw new ApiError(400, 'Invalid X-Workspace-Id');
      workspace = await resolveWorkspaceMember(db, c.get('user').id, workspaceId);
    } else {
      workspace = await defaultWorkspaceMember(db, c.get('user').id);
    }
    if (capability !== undefined) workspace.require(capability);
    c.set('workspace', workspace);
    await next();
  };
}
