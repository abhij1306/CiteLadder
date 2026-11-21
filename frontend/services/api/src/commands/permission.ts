import type { ApiKeyScope } from '@citeladder/contracts/api-keys';
import type { Context } from 'hono';

import { actorOf, requireCapability, type Actor } from '../auth/actor.ts';
import type { WorkspaceCapability } from '../auth/workspace.ts';
import type { AppEnv } from '../context.ts';

export type Permission = Readonly<{ capability: WorkspaceCapability; scope: ApiKeyScope }>;

declare const checked: unique symbol;

export type Authorized<P extends Permission> = Actor & { readonly [checked]: P };

export const permission = <const P extends Permission>(declared: P): P => declared;

export function authorize<P extends Permission>(actor: Actor, required: P): Authorized<P> {
  requireCapability(actor, required.capability, required.scope);
  return actor as Authorized<P>;
}

export function routeActor<P extends Permission>(c: Context<AppEnv>, required: P): Authorized<P> {
  const declared = c.get('permission');
  if (declared?.capability !== required.capability || declared.scope !== required.scope)
    throw new Error(
      `The route did not declare the command's permission (${required.capability}, ${required.scope})`,
    );
  return actorOf(c) as Authorized<P>;
}
