import { createHash } from 'node:crypto';
import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import { compareIdentityText } from '../analysis/comparison.ts';
import { publicUrl } from '../projects/safe-fetch.ts';

// Canonical serialization defines the stored `url_hash` keyspace: unreserved
// escapes decode, other escapes uppercase, the path re-quotes with its safe
// set and query pairs encode as `quote_plus`.
const UNRESERVED = /[A-Za-z0-9\-._~]/u;
const PATH_SAFE = /[A-Za-z0-9/%:@!$&'()*+,;=~\-._]/u;
const escapeByte = (char: string) => `%${char.codePointAt(0)!.toString(16).toUpperCase()}`;
const quote = (value: string) => encodeURIComponent(value).replaceAll(/[!'()*]/gu, escapeByte);
const quotePlus = (value: string) => quote(value).replaceAll('%20', '+');

function canonicalPath(pathname: string) {
  const decoded = pathname.replaceAll(/%([0-9a-f]{2})/giu, (_raw, hex: string) => {
    const char = String.fromCodePoint(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
  return Array.from(decoded, (char) => (PATH_SAFE.test(char) ? char : quote(char))).join('');
}

export function canonicalIdentity(value: string, base?: string) {
  const url = publicUrl(value, base);
  url.hostname = url.hostname.replace(/\.$/u, '');
  url.pathname = canonicalPath(url.pathname);
  const ignored = new Set([
    ...policy.site_health.tracking_params,
    ...policy.site_health.ignored_query_keys,
  ]);
  const pairs = [...url.searchParams]
    .filter(([key]) => !ignored.has(key.toLowerCase()))
    .sort((a, b) => compareIdentityText(a[0], b[0]) || compareIdentityText(a[1], b[1]));
  url.search = pairs.map(([key, item]) => `${quotePlus(key)}=${quotePlus(item)}`).join('&');
  return {
    url: url.href,
    hash: createHash('sha256').update(url.href).digest('hex'),
    domain: getDomain(url.hostname) ?? url.hostname,
  };
}
/** The canonical URL, or null when the value is not a public URL. */
/**
 * The identity hash of the same URL on the www/apex twin host, or null. Many
 * sites answer on both without redirecting; admission keeps one of the pair.
 */
export function hostTwinHash(value: string): string | null {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
    return canonicalIdentity(url.href).hash;
  } catch {
    return null;
  }
}

export function canonicalUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return canonicalIdentity(value, base).url;
  } catch {
    return null;
  }
}
export function citationIdentity(value: string) {
  try {
    const identity = canonicalIdentity(value);
    const host = new URL(identity.url).hostname;
    if (
      policy.source_pages.redirect_hosts.some(
        (redirect) => host === redirect || host.endsWith(`.${redirect}`),
      )
    )
      return null;
    return identity;
  } catch {
    return null;
  }
}
