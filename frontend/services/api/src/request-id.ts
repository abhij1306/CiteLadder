import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from './context.ts';
import { withCorrelationId } from './logging.ts';

const MAX_LENGTH = 128;
const SAFE_ID = /^[\p{L}\p{N}\-_.]+$/u;

function sanitizeCorrelationId(value: string): string {
  const candidate = value.trim();
  const length = [...candidate].length;
  return length > 0 && length <= MAX_LENGTH && SAFE_ID.test(candidate) ? candidate : '';
}

function generateCorrelationId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

export function requestId(headerName: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = sanitizeCorrelationId(c.req.header(headerName) ?? '') || generateCorrelationId();
    c.set('requestId', id);
    await withCorrelationId(id, next);
    c.header(headerName, id);
  };
}
