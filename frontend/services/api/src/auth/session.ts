/**
 * Every browser request acts as the install's single local user; there is no
 * sign-in (`auth/local.ts`).
 */
import type { MiddlewareHandler } from 'hono';

import type { ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { localAccount } from './local.ts';
import { membershipContext, membershipQuery, type MembershipRule } from './workspace.ts';

export type SessionUser = { id: string };

/**
 * Resolve the acting user and, given a membership rule, the workspace in one
 * read. Refusals keep their order: the request's target (400/422), membership
 * (404), then the rule's capability (403). The resolved user and workspace
 * live on the request context for every handler; nothing is kept across
 * requests.
 */
export function sessionUser(
  config: ServiceConfig,
  db: Database,
  membership?: MembershipRule,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const acting = (await config.auth.actingUser?.(c.req.raw)) ?? null;
    const userId = acting ?? (await localAccount(db)).userId;
    c.set('user', { id: userId });
    if (membership) {
      const target = membership.target(c);
      const member = await membershipQuery(db, userId, target).executeTakeFirst();
      const workspace = membershipContext(
        target,
        member ?? { workspace_id: null, role: null, holds_project: null },
      );
      if (membership.capability !== undefined) workspace.require(membership.capability);
      c.set('workspace', workspace);
    }
    await next();
  };
}
