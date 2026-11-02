/**
 * Conditional reads of persisted snapshots.
 *
 * A route whose payload is a projection of a persisted snapshot or a terminal
 * crawl marks it `revalidatable`. The browser may then keep the response, but
 * must revalidate it on every use (`private, no-cache`): the response carries
 * a weak ETag over its exact body, and a matching `If-None-Match` is answered
 * with `304 Not Modified` and no body. The tag hashes the serialized body, so
 * it changes whenever the payload does, whatever the snapshot's shape; the
 * read and its authorization still run on every request.
 */
import { createHash } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context.ts';

export const REVALIDATE_CACHE_CONTROL = 'private, no-cache';

/** Headers describing the body itself, which a bodiless 304 must not carry. */
const ENTITY_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-disposition',
];

/** Mark this response a revalidatable snapshot read and return its payload unchanged. */
export function revalidatable<T>(c: Context<AppEnv>, payload: T): T {
  c.header('cache-control', REVALIDATE_CACHE_CONTROL);
  return payload;
}

function bodyTag(body: ArrayBuffer): string {
  return `W/"${createHash('sha256').update(new Uint8Array(body)).digest('base64url')}"`;
}

/** Weak comparison (RFC 9110 §13.1.2): `W/` never distinguishes two tags. */
function matches(ifNoneMatch: string | undefined, tag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  const opaque = tag.replace(/^W\//, '');
  return ifNoneMatch
    .split(',')
    .some(
      (candidate) => candidate.trim() === '*' || candidate.trim().replace(/^W\//, '') === opaque,
    );
}

/** Tags revalidatable `GET` responses and answers a matching `If-None-Match` with 304. */
export function conditionalReads(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    if (c.req.method !== 'GET' || c.res.status !== 200) return;
    if (c.res.headers.get('cache-control') !== REVALIDATE_CACHE_CONTROL) return;
    // A route's own validator (a logo's content hash) stands; otherwise hash the body.
    const tag = c.res.headers.get('etag') ?? bodyTag(await c.res.clone().arrayBuffer());
    if (!matches(c.req.header('if-none-match'), tag)) {
      c.res.headers.set('etag', tag);
      return;
    }
    // Hono copies the replaced response's headers onto the new one; the
    // validators, cache policy and request id stay, the entity headers go.
    c.res = new Response(null, { status: 304, headers: { etag: tag } });
    for (const name of ENTITY_HEADERS) c.res.headers.delete(name);
  };
}
