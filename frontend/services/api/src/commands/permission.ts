/**
 * What a product command needs from its actor, declared once on the command.
 *
 * A route serving a command declares that `permission`; the route's gate (the
 * session's membership, or the API key's guard) checks it before parameters,
 * and the handler takes the checked actor with `routeActor`. A caller outside
 * a route (MCP) checks it with `authorize`. Either way the check runs once,
 * and a command accepts only an actor checked against its own permission.
 */
import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { Context } from 'hono';

import { actorOf, requireCapability, type Actor } from '../auth/actor.ts';
import type { WorkspaceCapability } from '../auth/workspace.ts';
import type { AppEnv } from '../context.ts';

/** The member's capability and, for an API key, the scope the key must hold. */
export type Permission = Readonly<{ capability: WorkspaceCapability; scope: ApiKeyScope }>;

declare const checked: unique symbol;

/** An actor whose live role (and key scope) was checked against `P`. */
export type Authorized<P extends Permission> = Actor & { readonly [checked]: P };

export const permission = <const P extends Permission>(declared: P): P => declared;

/** The check for a caller outside a route: 403 unless `actor` holds `required`. */
export function authorize<P extends Permission>(actor: Actor, required: P): Authorized<P> {
  requireCapability(actor, required.capability, required.scope);
  return actor as Authorized<P>;
}

/**
 * The request's actor, checked by the route's gate against `required`. A
 * handler naming a permission its route did not declare is a programming
 * error, never a pass.
 */
export function routeActor<P extends Permission>(c: Context<AppEnv>, required: P): Authorized<P> {
  const declared = c.get('permission');
  if (declared?.capability !== required.capability || declared.scope !== required.scope)
    throw new Error(
      `The route did not declare the command's permission (${required.capability}, ${required.scope})`,
    );
  return actorOf(c) as Authorized<P>;
}
