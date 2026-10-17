/**
 * API responses are never cached unless they opt into private caching.
 *
 * Every `/api/` and machine-route response, errors included, carries `private, no-store`
 * unless the route already chose `private, max-age=...`.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context.ts';
import { policy } from '../config.ts';

export function apiNoStore(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/') && !isMachinePath(c.req.path)) return;
    const cacheControl = c.res.headers.get('cache-control') ?? '';
    if (cacheControl.toLowerCase().startsWith('private, max-age=')) return;
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
