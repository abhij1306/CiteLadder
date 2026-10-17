/** Page grouping identity used by Action and evidence readers. */
import { policy } from '../config.ts';
import { stripTrailing } from '../text-order.ts';

export function normalizedUrlForCompare(url: string): string {
  const text = url.trim();
  try {
    const parsed = new URL(text);
    if (!parsed.hostname) return text.toLowerCase();
    // Preserve persisted Action grouping, including historical identities. Validate
    // with URL, but retain the observed host/path rather than URL's IDNA and
    // dot-segment normalization. This is not crawler identity.
    const [, rawHost, rawPath, rawQuery] =
      /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/iu.exec(text) ?? [];
    if (rawHost === undefined || rawPath === undefined) return text.toLowerCase();
    const host = rawHost
      .replace(/^.*@/u, '')
      .replace(/:\d*$/u, '')
      .replace(/^\[|\]$/gu, '')
      .toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    const path = stripTrailing(rawPath, '/') || '/';
    const pairs = [...new URLSearchParams(rawQuery)].filter(
      ([key]) => !policy.opportunity.tracking_query_params.includes(key.toLowerCase()),
    );
    const quote = (value: string) =>
      encodeURIComponent(value)
        .replaceAll(/[!'()*]/gu, (char) => `%${char.codePointAt(0)!.toString(16).toUpperCase()}`)
        .replaceAll('%20', '+');
    const query = pairs.map(([key, value]) => `${quote(key)}=${quote(value)}`).join('&');
    const search = query ? `?${query}` : '';
    return `${parsed.protocol}//${host}${port}${path}${search}`;
  } catch {
    return text.toLowerCase();
  }
}
