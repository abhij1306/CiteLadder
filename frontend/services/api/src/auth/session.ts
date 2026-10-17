/**
 * Every browser request acts as the install's single local user; there is no
 * sign-in (`auth/local.ts`).
 */
import type { MiddlewareHandler } from 'hono';

import type { ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { localAccount } from './local.ts';

export type SessionUser = { id: string };

export function sessionUser(config: ServiceConfig, db: Database): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const acting = (await config.auth.actingUser?.(c.req.raw)) ?? null;
    c.set('user', { id: acting ?? (await localAccount(db)).userId });
    await next();
  };
}
