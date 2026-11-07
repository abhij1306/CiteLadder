/**
 * Workspace membership and the role/capability matrix.
 *
 * Workspace config owns the matrix and refusal wording; a role
 * missing from it confers nothing (fail closed).
 * A non-member cannot tell an existing workspace from a missing one: both 404.
 */
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import type { Context } from 'hono';
import { sql } from 'kysely';

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

/**
 * A row lock on the membership read, for a caller whose transaction must not
 * race a concurrent role change or removal.
 */
type MemberLock = 'share' | 'update';

/**
 * The one membership predicate every authorization check reads: the user's
 * row in the workspace, held by an active account.
 */
function authorizingMember(db: Database, workspaceId: string, userId: string, lock?: MemberLock) {
  const member = db
    .selectFrom('workspace_members')
    .innerJoin('users', 'users.id', 'workspace_members.user_id')
    .select(['workspace_members.workspace_id', 'workspace_members.role'])
    .where('workspace_members.workspace_id', '=', workspaceId)
    .where('workspace_members.user_id', '=', userId)
    .where('users.is_active', '=', true);
  if (lock === 'share') return member.forShare('workspace_members');
  if (lock === 'update') return member.forUpdate('workspace_members');
  return member;
}

/** The user's membership, if any; disabled accounts never authorize. */
export async function findWorkspaceMember(
  db: Database,
  userId: string,
  workspaceId: string,
  lock?: MemberLock,
): Promise<WorkspaceContext | undefined> {
  const member = await authorizingMember(db, workspaceId, userId, lock).executeTakeFirst();
  return member && new WorkspaceContext(member.workspace_id, member.role);
}

/**
 * Whether the user's live membership permits `capability` in the workspace:
 * the check a worker, an invitation or an operator runs for a stored actor.
 */
export async function memberCan(
  db: Database,
  workspaceId: string,
  userId: string,
  capability: WorkspaceCapability,
  lock?: MemberLock,
): Promise<boolean> {
  const member = await findWorkspaceMember(db, userId, workspaceId, lock);
  return member?.allows(capability) ?? false;
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

/** The membership a request resolves, read from the request before any query. */
export type MembershipTarget =
  | { kind: 'project'; projectId: string }
  /** `projectId`: the path project the resolved workspace must hold, if any. */
  | { kind: 'workspace'; workspaceId: string; projectId: string | null }
  | { kind: 'earliest'; projectId: string | null };

/**
 * The `X-Workspace-Id` the request sent: absent, or a UUID. Anything else,
 * including an empty value, is a 400, never a fallback to the default workspace.
 */
function selectedWorkspace(c: Context<AppEnv>): string | null {
  const selected = c.req.header('x-workspace-id');
  if (selected === undefined) return null;
  const workspaceId = parseUuid(selected);
  if (workspaceId === null) throw new ApiError(400, 'Invalid X-Workspace-Id');
  return workspaceId;
}

/**
 * How a route resolves its workspace; `sessionUser` reads the membership in
 * the same statement as the session's user. `target` may throw the request's
 * 400 or 422, which the session's 401 precedes. `capability` is enforced as
 * soon as membership resolves.
 */
export type MembershipRule = {
  target: (c: Context<AppEnv>) => MembershipTarget;
  capability: WorkspaceCapability | undefined;
};

/**
 * Through the project in the path alone: the caller must belong to the
 * project's workspace. A missing project and a foreign one are the same
 * `Project not found`, and `X-Workspace-Id` is not read, so a link or an
 * `<img>` opens a project in any workspace its caller belongs to. The route
 * checks its capability after workspace access.
 */
export const projectMembership: MembershipRule = {
  target: (c) => ({
    kind: 'project',
    projectId: pathUuid(c.req.param('project_id'), 'project_id'),
  }),
  capability: undefined,
};

/**
 * The path project inside the active workspace (`activeWorkspaceMembership`):
 * the workspace resolves and its capability is checked as for a flat route,
 * and the context names the project only when that workspace holds it. The
 * route refuses a project it does not name (`Project not found`) after the
 * access gate and parameter validation, as a handler's own check would.
 */
export function activeProjectMembership(capability?: WorkspaceCapability): MembershipRule {
  return {
    target: (c) => {
      const workspaceId = selectedWorkspace(c);
      // An invalid path ID resolves no project; parameter validation refuses it.
      const projectId = parseUuid(c.req.param('project_id') ?? '');
      return workspaceId === null
        ? { kind: 'earliest', projectId }
        : { kind: 'workspace', workspaceId, projectId };
    },
    capability,
  };
}

/** The path `:workspace_id`, optionally gated on one capability. */
export function pathWorkspaceMembership(capability?: WorkspaceCapability): MembershipRule {
  return {
    target: (c) => ({
      kind: 'workspace',
      workspaceId: pathUuid(c.req.param('workspace_id'), 'workspace_id'),
      projectId: null,
    }),
    capability,
  };
}

/**
 * The active workspace of a flat route: the `X-Workspace-Id` header when the
 * client selects one, otherwise the caller's earliest tenant membership.
 * Membership is verified either way, and a foreign workspace is a 404.
 */
export function activeWorkspaceMembership(capability?: WorkspaceCapability): MembershipRule {
  return {
    target: (c) => {
      const workspaceId = selectedWorkspace(c);
      return workspaceId === null
        ? { kind: 'earliest', projectId: null }
        : { kind: 'workspace', workspaceId, projectId: null };
    },
    capability,
  };
}

/**
 * The user's tenant membership `target` names, as one statement (at most one
 * row), with whether that workspace holds the target's project.
 */
export function membershipQuery(db: Database, userId: string, target: MembershipTarget) {
  const projectId = target.kind === 'project' ? null : target.projectId;
  const holdsProject =
    projectId === null
      ? sql<boolean>`false`
      : sql<boolean>`exists (select 1 from projects where projects.id = ${projectId} and projects.workspace_id = workspace_members.workspace_id)`;
  const member = db
    .selectFrom('workspace_members')
    .select(['workspace_members.workspace_id', 'workspace_members.role'])
    .select(holdsProject.as('holds_project'))
    .where('workspace_members.user_id', '=', userId);
  switch (target.kind) {
    case 'project':
      return member.where(
        'workspace_members.workspace_id',
        '=',
        db
          .selectFrom('projects')
          .select('projects.workspace_id')
          .where('id', '=', target.projectId),
      );
    case 'workspace':
      return member.where('workspace_members.workspace_id', '=', target.workspaceId);
    case 'earliest':
      // The membership ID breaks a timestamp tie, so the default never flips.
      return member
        .orderBy('workspace_members.created_at', 'asc')
        .orderBy('workspace_members.id', 'asc')
        .limit(1);
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

/** The context a resolved membership authorizes, or the target's 404. */
export function membershipContext(
  target: MembershipTarget,
  member: { workspace_id: string | null; role: string | null; holds_project: boolean | null },
): WorkspaceContext {
  if (member.workspace_id === null || member.role === null)
    throw notFound(target.kind === 'project' ? 'Project' : 'Workspace');
  // A project target resolved through its project; others name it only when held.
  const named = target.kind === 'project' || member.holds_project === true;
  return new WorkspaceContext(member.workspace_id, member.role, named ? target.projectId : null);
}
