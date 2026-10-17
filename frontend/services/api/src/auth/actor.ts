/**
 * Who performs a product command: the local user (browser requests), a
 * public API key acting for the user who created it, or the MCP token acting
 * for the local user after the user confirms a change.
 *
 * `role` is the user's workspace role, loaded for the request. A key's scopes
 * intersect that role; they never widen it.
 */
import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { Context } from 'hono';

import type { AppEnv } from '../context.ts';
import { capabilityDenied, roleAllows, type WorkspaceCapability } from './workspace.ts';

export type Actor = {
  kind: 'member' | 'api_key' | 'mcp';
  workspaceId: string;
  userId: string;
  role: string;
  scopes: ReadonlySet<ApiKeyScope> | 'all';
};

/**
 * 403 unless the actor's role permits `capability` and, for a key, the key
 * holds `scope`. A command with no public scope is closed to every key.
 */
export function requireCapability(
  actor: Actor,
  capability: WorkspaceCapability,
  scope?: ApiKeyScope,
): void {
  if (!roleAllows(actor.role, capability)) throw capabilityDenied(capability);
  if (actor.scopes === 'all') return;
  if (scope === undefined || !actor.scopes.has(scope))
    throw capabilityDenied(
      capability,
      scope === undefined
        ? 'API keys cannot perform this operation'
        : `This API key does not hold the ${scope} scope`,
    );
}

/** The request's actor: its API key's, or the local user's. */
export function actorOf(c: Context<AppEnv>): Actor {
  const actor = c.get('actor');
  if (actor) return actor;
  const workspace = c.get('workspace');
  return {
    kind: 'member',
    workspaceId: workspace.workspaceId,
    userId: c.get('user').id,
    role: workspace.role,
    scopes: 'all',
  };
}
