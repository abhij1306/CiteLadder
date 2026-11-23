import { policy } from '../config.ts';

export function fitsIndexKey(...values: readonly string[]): boolean {
  let bytes = 0;
  for (const value of values) bytes += Buffer.byteLength(value, 'utf8');
  return bytes <= policy.storage.index_key_max_bytes;
}
