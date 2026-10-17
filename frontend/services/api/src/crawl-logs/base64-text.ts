/** Canonical padded base64, as Firehose records and Pub/Sub messages carry it. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
// Non-streaming decode() keeps no state between calls, so one decoder serves all.
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The UTF-8 text of a base64 payload of at most `maxBytes`, or null when it is not one. */
export function base64Text(data: string, maxBytes: number): string | null {
  if (!BASE64.test(data) || (data.length / 4) * 3 > maxBytes + 2) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maxBytes) return null;
  try {
    return UTF8.decode(bytes);
  } catch {
    return null;
  }
}
