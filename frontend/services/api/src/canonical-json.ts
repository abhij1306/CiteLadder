import { createHash } from 'node:crypto';

import { compareText } from './text-order.ts';

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scalarJson(value: unknown): string {
  const type = typeof value;
  if (value === null || type === 'string' || type === 'number' || type === 'boolean')
    return JSON.stringify(value);
  throw new TypeError(`canonicalJson cannot encode a ${typeof value} value`);
}

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

export const canonicalHash = (value: unknown, ascii = true) =>
  createHash('sha256').update(canonicalJson(value, ascii)).digest('hex');
