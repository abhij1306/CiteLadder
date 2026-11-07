/**
 * Page identity: the canonical page URL, a crawl-log path's identity and an
 * analytics landing page. The canonical text and its hash are persisted join
 * keys across traffic, referrals, crawl logs and source pages, so the output
 * never changes byte for byte.
 */
import { domainToASCII } from 'node:url';

import { policy } from './config.ts';
import { crawlLogs } from './config/crawl-logs.ts';
import { crawlers } from './config/crawlers.ts';
import { compareIdentityText } from './analysis/comparison.ts';
import { hash } from './crypto-text.ts';
import { normalizeQuery } from './traffic/normalization.ts';
import { stripTrailing } from './text-order.ts';

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

/** A requested path's page identity: display path, joinable URL and hash, folder and resource class. */
export function pathIdentity(path: string, origin: string) {
  const withoutQuery = path.split(/[?#]/u)[0]!;
  const canonical = canonicalPage(withoutQuery, origin);
  if (!canonical) return null;
  // Inspect decoded segments to catch encoded secrets without changing exact identity.
  let display = new URL(canonical).pathname;
  try {
    display = decodeURIComponent(display);
  } catch {
    return null;
  }
  let redacted = false;
  for (const pattern of crawlLogs.secret_path_patterns) {
    display = display.replace(new RegExp(pattern, 'giu'), () => {
      redacted = true;
      return '[redacted]';
    });
  }
  if (display.length > 2048) return null;
  const folder =
    '/' + display.split('/').filter(Boolean).slice(0, crawlLogs.folder_depth).join('/');
  const lower = display.toLowerCase();
  const resource = crawlers.resource_rules.find(
    (rule) =>
      rule.paths.some((value) => lower === value.toLowerCase()) ||
      rule.extensions.some((value) => lower.endsWith(value.toLowerCase())),
  );
  return {
    display_path: display,
    canonical_url: redacted ? null : canonical,
    identity: redacted ? 'non_joinable' : 'exact',
    identity_reason: redacted ? 'redacted_secret' : null,
    url_hash: redacted ? null : hash(canonical),
    folder,
    resource_class: resource?.resource_class ?? 'page',
  };
}

/** An analytics landing path on one of the project's hosts as its joinable page, or null. */
export function landingPage(path: string, host: string, hosts: ReadonlySet<string>) {
  const normalizedHost = host.toLowerCase();
  if (!hosts.has(normalizedHost) || path === '(not set)') return null;
  const origin = `https://${normalizedHost}`;
  const page = canonicalPage(path.split(/[?#]/u)[0]!, origin);
  return page && new URL(page).origin === origin && pathIdentity(page, origin)?.identity === 'exact'
    ? page
    : null;
}
