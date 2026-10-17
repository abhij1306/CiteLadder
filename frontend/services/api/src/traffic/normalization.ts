import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

import { policy } from '../config.ts';
import { compareIdentityText } from '../analysis/comparison.ts';
import { stripTrailing } from '../text-order.ts';

/** Runs of whitespace as one space, trimmed. */
export function collapseIdentityWhitespace(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(' ');
}

/** A query's persisted identity: NFKC, lower case, collapsed whitespace. */
export function normalizeQuery(value: string): string {
  return collapseIdentityWhitespace(value.normalize('NFKC').toLowerCase());
}

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Canonical page identity, without fetching or performing URL admission. */
export function canonicalPage(input: string, origin?: string | null): string | null {
  try {
    let value = input.trim();
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:/iu.test(value) && origin)
      value = new URL(value, `${stripTrailing(origin, '/')}/`).href;
    const parsed = new URL(value);
    const scheme = parsed.protocol.slice(0, -1);
    if (!policy.traffic.url_schemes.includes(scheme) || parsed.username || parsed.password)
      return null;
    // Site Health still stores the compared url_hash. Retain its raw path
    // (including dot segments) and Unicode-folded hostname in this identity only.
    const raw = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/iu.exec(value);
    if (!raw) return null;
    const [, rawAuthority, rawPath] = raw;
    if (rawAuthority === undefined || rawAuthority.includes('@')) return null;
    const rawHost = rawAuthority.replace(/:\d+$/u, '');
    const host = domainToASCII(normalizeQuery(stripTrailing(rawHost, '.')));
    if (!host) return null;
    const defaultPort = scheme === 'https' ? 443 : 80;
    const port = parsed.port ? Number(parsed.port) : defaultPort;
    if (!policy.traffic.url_ports.includes(port)) return null;
    const path = (rawPath || '/').replace(/%([0-9a-f]{2})/giu, (_match, hex: string) => {
      const char = String.fromCodePoint(Number.parseInt(hex, 16));
      return /[a-z0-9\-._~]/iu.test(char) ? char : `%${hex.toUpperCase()}`;
    });
    const encoded = [...path]
      .map((char) =>
        /[A-Za-z0-9/%:@!$&'()*+,;=~._-]/u.test(char) ? char : encodeURIComponent(char),
      )
      .join('');
    const pairs = [...parsed.searchParams].filter(
      ([key]) => !policy.traffic.ignored_query_keys.includes(key.toLowerCase()),
    );
    pairs.sort(([ak, av], [bk, bv]) => compareIdentityText(ak, bk) || compareIdentityText(av, bv));
    const quote = (s: string) =>
      encodeURIComponent(s)
        .replaceAll(/[!'()*]/gu, (c) => `%${c.codePointAt(0)!.toString(16).toUpperCase()}`)
        .replaceAll('%20', '+');
    const query = pairs.map(([k, v]) => `${quote(k)}=${quote(v)}`).join('&');
    const authority = port === defaultPort ? host : `${host}:${port}`;
    const search = query ? `?${query}` : '';
    return `${scheme}://${authority}${encoded}${search}`;
  } catch {
    return null;
  }
}
