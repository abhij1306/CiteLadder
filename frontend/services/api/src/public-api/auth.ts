/**
 * Public API authentication: `Authorization: Bearer cl_live_…` only. Cookies
 * and `X-Workspace-Id` are never read.
 *
 * A request passes, in order: the key (401 `invalid_api_key`), the per-key
 * and per-workspace rate limits (429), the creator's active account and
 * membership, the operation's capability intersected with the key's scope
 * (403), then the path project and its owned IDs (404 outside the workspace,
 * the key's allowlist or the project).
 */
import { apiKeyScopeSchema, type ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { MiddlewareHandler } from 'hono';

import { resolveCaller, touchApiKey } from '../api-keys/keys.ts';
import { requireCapability, type Actor } from '../auth/actor.ts';
import {
  findWorkspaceMember,
  pathUuid,
  WorkspaceContext,
  type WorkspaceCapability,
} from '../auth/workspace.ts';
import type { ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireProject } from '../projects/access.ts';
import { requirePathOwnership } from './ownership.ts';
import { spendRateLimits } from './rate-limit.ts';

export function apiKeyAuth(
  db: Database,
  config: ServiceConfig,
  operation: { capability: WorkspaceCapability; scope: ApiKeyScope },
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = await resolveCaller(db, config.auth.apiKeyPepper, c.req.header('authorization'));
    const rateLimit = await spendRateLimits(db, key);
    for (const [name, value] of Object.entries(rateLimit)) c.header(name, value);
    const [member, creator] = await Promise.all([
      findWorkspaceMember(db, key.created_by_user_id, key.workspace_id),
      db
        .selectFrom('users')
        .select('is_active')
        .where('id', '=', key.created_by_user_id)
        .executeTakeFirst(),
    ]);
    // A key acts as its creator, so it stops when that user is deactivated.
    if (member === undefined || !creator?.is_active)
      throw new ApiError(401, 'This API key no longer has workspace access', {
        code: 'invalid_api_key',
      });
    const actor: Actor = {
      kind: 'api_key',
      workspaceId: key.workspace_id,
      userId: key.created_by_user_id,
      role: member.role,
      scopes: new Set(
        key.scopes.flatMap((scope) => {
          const parsed = apiKeyScopeSchema.safeParse(scope);
          return parsed.success ? [parsed.data] : [];
        }),
      ),
    };
    requireCapability(actor, operation.capability, operation.scope);
    const projectId = await pathProject(
      db,
      key.workspace_id,
      c.req.param('project_id'),
      key.project_ids,
    );
    if (projectId !== null)
      await requirePathOwnership(
        db,
        key.workspace_id,
        projectId,
        c.req.param(),
        operation.capability === 'read' ? 'read' : 'write',
      );
    c.set('actor', actor);
    c.set('apiKey', { id: key.id, projectIds: key.project_ids });
    c.set('workspace', new WorkspaceContext(key.workspace_id, member.role, projectId));
    await touchApiKey(db, key);
    await next();
    for (const [name, value] of Object.entries(rateLimit)) c.res.headers.set(name, value);
  };
}

async function pathProject(
  db: Database,
  workspaceId: string,
  raw: string | undefined,
  allowlist: readonly string[] | null,
): Promise<string | null> {
  if (raw === undefined) return null;
  const projectId = pathUuid(raw, 'project_id');
  if (allowlist !== null && !allowlist.includes(projectId)) throw notFound('Project');
  await requireProject(db, { workspaceId, projectId });
  return projectId;
}
