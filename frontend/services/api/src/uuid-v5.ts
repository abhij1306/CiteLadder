/** RFC 9562 name-based (version 5) UUIDs. */
import { createHash } from 'node:crypto';

/** The v5 UUID of `name` in the `namespace` UUID. */
export function uuidV5(namespace: string, name: string): string {
  // Version 5 is defined over SHA-1; the result is an identifier, not a secret.
  const bytes = createHash('sha1') // NOSONAR
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
