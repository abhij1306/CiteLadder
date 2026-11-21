import { z } from 'zod';

import { policy } from '../config.ts';
import { ApiError } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';

const P = policy.public_api.page;

export const pageQuery = {
  cursor: { scalar: { kind: 'str', maxLength: 512 } },
  limit: { scalar: { kind: 'int', ge: 1, le: P.max_limit }, default: P.default_limit },
} as const;

export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullable() });
}

export type PageScope = { endpoint: string; filters: Record<string, unknown> };

function invalidCursor(message: string): ApiError {
  return new ApiError(400, message, { code: 'invalid_cursor' });
}

export function cursorId(cursor: string | null, scope: PageScope): string | null {
  if (cursor === null || cursor === '') return null;
  try {
    const [id] = decodeKeysetCursor(cursor, scope.endpoint, scope.filters);
    if (id === undefined) throw invalidCursor('Invalid cursor');
    return id;
  } catch (error) {
    if (error instanceof InvalidCursorError) throw invalidCursor(error.message);
    throw error;
  }
}

export function nextCursor(scope: PageScope, lastId: string): string {
  return encodeKeysetCursor(scope.endpoint, scope.filters, [lastId]);
}

export function pageAfter<Item extends { id: string }>(
  items: readonly Item[],
  page: { cursor: string | null; limit: number },
  scope: PageScope,
): { items: Item[]; next_cursor: string | null } {
  const after = cursorId(page.cursor, scope);
  let start = 0;
  if (after !== null) {
    const index = items.findIndex((item) => item.id === after);
    if (index < 0) throw invalidCursor('Invalid cursor');
    start = index + 1;
  }
  const slice = items.slice(start, start + page.limit);
  const last = slice.at(-1);
  return {
    items: slice,
    next_cursor:
      last !== undefined && start + page.limit < items.length ? nextCursor(scope, last.id) : null,
  };
}
