import { createHash } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context.ts';

export const REVALIDATE_CACHE_CONTROL = 'private, no-cache';

const ENTITY_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-disposition',
];

export function revalidatable<T>(c: Context<AppEnv>, payload: T): T {
  c.header('cache-control', REVALIDATE_CACHE_CONTROL);
  return payload;
}

function bodyTag(body: ArrayBuffer): string {
  return `W/"${createHash('sha256').update(new Uint8Array(body)).digest('base64url')}"`;
}

function matches(ifNoneMatch: string | undefined, tag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  const opaque = tag.replace(/^W\//, '');
  return ifNoneMatch
    .split(',')
    .some(
      (candidate) => candidate.trim() === '*' || candidate.trim().replace(/^W\//, '') === opaque,
    );
}

export function conditionalReads(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (c.req.method !== 'GET' || c.res.status !== 200) return;
    if (c.res.headers.get('cache-control') !== REVALIDATE_CACHE_CONTROL) return;
    const tag = c.res.headers.get('etag') ?? bodyTag(await c.res.clone().arrayBuffer());
    if (!matches(c.req.header('if-none-match'), tag)) {
      c.res.headers.set('etag', tag);
      return;
    }
    c.res = new Response(null, { status: 304, headers: { etag: tag } });
    for (const name of ENTITY_HEADERS) c.res.headers.delete(name);
  };
}
