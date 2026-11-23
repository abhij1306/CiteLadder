import { createHash } from 'node:crypto';
import { z } from 'zod';

import { compareText } from '../text-order.ts';

export class InvalidCursorError extends Error {}

function filterFingerprint(scope: string, filters: Record<string, unknown>): string {
  const cleaned = Object.entries(filters)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => compareText(a, b));
  return createHash('sha256')
    .update(JSON.stringify([scope, cleaned]))
    .digest('hex')
    .slice(0, 16);
}

export function encodeKeysetCursor(
  scope: string,
  filters: Record<string, unknown>,
  sortValues: readonly string[],
): string {
  const payload = { fp: filterFingerprint(scope, filters), k: sortValues };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const cursorPayload = z.object({ fp: z.unknown().optional(), k: z.array(z.string()) });

export function decodeKeysetCursor(
  cursor: string,
  scope: string,
  filters: Record<string, unknown>,
): string[] {
  if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new InvalidCursorError('invalid cursor');
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError('invalid cursor');
  }
  const payload = cursorPayload.safeParse(decoded);
  if (!payload.success) throw new InvalidCursorError('invalid cursor');
  if (payload.data.fp !== filterFingerprint(scope, filters)) {
    throw new InvalidCursorError('cursor does not match the current endpoint filters');
  }
  return payload.data.k;
}
