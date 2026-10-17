/**
 * UUID request values: the hyphenated or 32-digit hex spelling, optionally
 * braced or `urn:uuid:`-prefixed, canonicalized to lowercase hyphenated form.
 */
const HEX_32 = /^[0-9a-f]{32}$/iu;
const HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The canonical UUID, or null when `value` is not one. */
export function parseUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let body = value;
  if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1);
  else if (body.toLowerCase().startsWith('urn:uuid:')) body = body.slice('urn:uuid:'.length);
  if (!HEX_32.test(body) && !HYPHENATED.test(body)) return null;
  const hex = body.replaceAll('-', '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
