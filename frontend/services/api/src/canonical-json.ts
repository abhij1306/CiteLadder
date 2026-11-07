/** The one canonical JSON for stored identities and fingerprints of structured values. */
import { createHash } from 'node:crypto';

import { compareText } from './text-order.ts';

/**
 * Compact JSON with keys recursively sorted in code-unit order, non-ASCII
 * escaped as `\uXXXX` unless `ascii` is false. The bytes are persisted inside
 * identity hashes, so the format never changes.
 */
export function canonicalJson(value: unknown, ascii = true): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, ascii)).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([k, v]) => `${canonicalJson(k, ascii)}:${canonicalJson(v, ascii)}`)
      .join(',')}}`;
  if (!ascii) return JSON.stringify(value);
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (char) => String.raw`\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  );
}

/** SHA-256 hex of `value` as canonical JSON. */
export const canonicalHash = (value: unknown, ascii = true) =>
  createHash('sha256').update(canonicalJson(value, ascii)).digest('hex');
