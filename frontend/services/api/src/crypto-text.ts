/** Random base62 text and canonical-JSON fingerprints shared across owners. */
import { createHash, randomInt } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Base62 characters needed to carry at least `bits` random bits. */
export const base62Length = (bits: number) => Math.ceil(bits / Math.log2(BASE62.length));

/** `length` uniformly random base62 characters: no punctuation to mangle. */
export function base62(length: number): string {
  return Array.from({ length }, () => BASE62.charAt(randomInt(BASE62.length))).join('');
}

// Sorted keys bind nested values regardless of insertion or jsonb key order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
/** SHA-256 of `value` as canonical JSON. */
export function fingerprint(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
