/**
 * Opaque keyset cursors bound to an endpoint scope and its filters.
 *
 * The filter fingerprint travels inside the cursor, so a cursor replayed
 * against a different scope or filter set is refused.
 */
import { createHash } from 'node:crypto';

import { compareText } from '../text-order.ts';

/** A cursor that is malformed or belongs to another scope or filter set. */
export class InvalidCursorError extends Error {}

/** Deterministic short fingerprint of a scope and its non-empty filters. */
function filterFingerprint(scope: string, filters: Record<string, unknown>): string {
  const cleaned = Object.entries(filters)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => compareText(a, b));
  return createHash('sha256')
    .update(JSON.stringify([scope, cleaned]))
    .digest('hex')
    .slice(0, 16);
}

/** The cursor for the page after the row whose sort values are given. */
export function encodeKeysetCursor(
  scope: string,
  filters: Record<string, unknown>,
  sortValues: readonly string[],
): string {
  const payload = { fp: filterFingerprint(scope, filters), k: sortValues };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** The cursor's sort values; `InvalidCursorError` when it does not belong here. */
export function decodeKeysetCursor(
  cursor: string,
  scope: string,
  filters: Record<string, unknown>,
): string[] {
  // Node's base64url decoder skips foreign characters; refuse them first.
  if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new InvalidCursorError('invalid cursor');
  let payload: { fp?: unknown; k?: unknown } | null;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof payload;
  } catch {
    throw new InvalidCursorError('invalid cursor');
  }
  if (
    payload === null ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.k) ||
    !payload.k.every((value) => typeof value === 'string')
  ) {
    throw new InvalidCursorError('invalid cursor');
  }
  if (payload.fp !== filterFingerprint(scope, filters)) {
    throw new InvalidCursorError('cursor does not match the current endpoint filters');
  }
  return payload.k as string[];
}
