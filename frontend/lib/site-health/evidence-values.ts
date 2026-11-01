/** Narrowing for persisted issue evidence, shared by the evidence formatters. Pure. */

export type Evidence = Record<string, unknown>;

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item) => item.length > 0) : [];
}

export function records(value: unknown): Evidence[] {
  return Array.isArray(value)
    ? value.filter((item): item is Evidence => typeof item === 'object' && item !== null)
    : [];
}

/** A URL without its query string or fragment: `?qv=…` quick-view links are one link. */
export function withoutQuery(url: string): string {
  return url.replace(/[?#].*$/u, '');
}

function parsedUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The URL's origin, or null when it does not parse. */
export function originOf(url: string): string | null {
  return parsedUrl(url)?.origin ?? null;
}

/** A same-site link reads as its path; another host keeps its full URL. */
export function sitePath(url: string, origin: string | null): string {
  const parsed = parsedUrl(url);
  if (!parsed || (origin !== null && parsed.origin !== origin)) return url;
  return parsed.pathname;
}
