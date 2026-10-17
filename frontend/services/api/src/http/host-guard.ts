/**
 * DNS-rebinding guard. CiteLadder has no login, so a page on another site
 * that rebinds its own name to this server's address must not reach the API:
 * `/api`, `/v1` and `/mcp` answer only to configured host names.
 */
import type { MiddlewareHandler } from 'hono';

import type { ServiceConfig } from '../config.ts';
import type { AppEnv } from '../context.ts';
import { ApiError } from '../errors.ts';
import { isMachinePath } from './no-store.ts';

function guarded(path: string): boolean {
  return (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/mcp' ||
    path.startsWith('/mcp/') ||
    isMachinePath(path)
  );
}

export function hostGuard(config: Pick<ServiceConfig, 'auth'>): MiddlewareHandler<AppEnv> {
  const hosts = config.auth.allowedHosts;
  return async (c, next) => {
    if (!hosts.has('*') && guarded(c.req.path)) {
      const host = new URL(c.req.url).hostname.toLowerCase();
      if (!hosts.has(host))
        throw new ApiError(403, 'Host not allowed. Add it to ALLOWED_HOSTS to serve it.');
    }
    await next();
  };
}
