/**
 * API responses are never stored unless they are revalidated on every use.
 *
 * Every `/api/` and machine-route response, errors included, carries `private, no-store`
 * unless the route chose revalidation (`http/revalidate.ts`); nothing is
 * served from a browser cache without a request that re-checks access.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context.ts';
import { policy } from '../config.ts';
import { REVALIDATE_CACHE_CONTROL } from './revalidate.ts';

export function apiNoStore(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/') && !isMachinePath(c.req.path)) return;
    const cacheControl = c.res.headers.get('cache-control') ?? '';
    if (cacheControl === REVALIDATE_CACHE_CONTROL && [200, 304].includes(c.res.status)) return;
    c.res.headers.set('cache-control', 'private, no-store, max-age=0');
    c.res.headers.set('pragma', 'no-cache');
    c.res.headers.set('expires', '0');
  };
}

/** A public API (`/v1`) path. */
export function isMachinePath(path: string): boolean {
  const prefix = policy.api.machine_prefix;
  return path === prefix || path.startsWith(prefix + '/');
}
