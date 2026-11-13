/** The one canonical JSON for stored identities and fingerprints of structured values. */
import { createHash } from 'node:crypto';

import { compareText } from './text-order.ts';

/** True for an object literal (or a null-prototype record), not a Date, Map, Set or class instance. */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The JSON text of a scalar, or a throw for a value JSON has no text for. */
function scalarJson(value: unknown): string {
  const type = typeof value;
  if (value === null || type === 'string' || type === 'number' || type === 'boolean')
    return JSON.stringify(value);
  throw new TypeError(`canonicalJson cannot encode a ${typeof value} value`);
}

/**
 * Compact JSON with keys recursively sorted in code-unit order, non-ASCII
 * escaped as `\uXXXX` unless `ascii` is false. The bytes are persisted inside
 * identity hashes, so the format never changes. Only JSON values are encoded:
 * `undefined`, functions, symbols, bigints and non-plain objects (`Date`,
 * `Map`, `Set`, class instances) throw instead of hashing as something else.
 */
export function canonicalJson(value: unknown, ascii = true): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, ascii)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    if (!isPlainObject(value))
      throw new TypeError(
        `canonicalJson cannot encode a ${value.constructor?.name ?? 'non-plain'} object`,
      );
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([k, v]) => `${canonicalJson(k, ascii)}:${canonicalJson(v, ascii)}`)
      .join(',')}}`;
  }
  const text = scalarJson(value);
  if (!ascii) return text;
  return text.replace(
    /[\u0080-￿]/g,
    (char) => String.raw`\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  );
}

/** SHA-256 hex of `value` as canonical JSON. */
export const canonicalHash = (value: unknown, ascii = true) =>
  createHash('sha256').update(canonicalJson(value, ascii)).digest('hex');
