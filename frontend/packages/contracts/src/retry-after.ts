/**
 * The one reader of a `Retry-After` header (RFC 9110 section 10.2.3): a
 * delay in seconds or an HTTP date. The API service reads provider headers
 * with it and the browser reads the API's.
 *
 * Only a positive wait is advice. An absent, empty, zero, negative or
 * unparseable value, or a date already past, is `undefined`, so every caller
 * falls back to its own backoff rather than retrying at once.
 */
const DELAY_SECONDS = /^\d+(?:\.\d+)?$/u;

export function retryAfterSeconds(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  const raw = header?.trim();
  if (!raw) return undefined;
  // A bare number is a delay; `Date.parse` would read it as a year.
  const seconds = DELAY_SECONDS.test(raw) ? Number(raw) : (Date.parse(raw) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
