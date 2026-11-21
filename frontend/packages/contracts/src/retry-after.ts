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
