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

export function withoutQuery(url: string): string {
  const end = url.search(/[?#]/u);
  return end < 0 ? url : url.slice(0, end);
}

function parsedUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function originOf(url: string): string | null {
  return parsedUrl(url)?.origin ?? null;
}

export function sitePath(url: string, origin: string | null): string {
  const parsed = parsedUrl(url);
  if (!parsed || (origin !== null && parsed.origin !== origin)) return url;
  return parsed.pathname;
}
