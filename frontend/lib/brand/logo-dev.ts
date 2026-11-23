/**
 * Logo.dev fallback for brand avatars.
 *
 * Our own crawler (the API's `projects/logo-refresh.ts`) is the primary source and
 * stays that way: it caches the real asset in our database and serves it
 * same-origin. But some sites simply will not serve *us* an icon — one-site.example
 * hangs on our bot user-agent, another-site.example answers the WAF's 403 — and
 * no amount of crawler work fixes that. Logo.dev has already fetched those,
 * keyed by the same registrable domain we already have.
 *
 * `img.logo.dev` is a public CDN and `pk_*` is a *publishable* key, so the
 * browser hits it directly: no backend call, no SSRF surface, no API key on the
 * server. The domain does leave the user's browser to a third party, which is
 * the trade for covering the sites that block us.
 *
 * `fallback=404` is deliberate. Logo.dev's default is a grey monogram at
 * 200 OK; we would rather 404 and let `<BrandMark>`'s own letter show, since
 * that matches the rest of the UI.
 */

import { getLogoDevPublishable } from '@/lib/config/env';

function stripTrailingDots(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 46) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function logoDomain(websiteUrl: string | null | undefined): string | null {
  const raw = String(websiteUrl ?? '').trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = stripTrailingDots(parsed.hostname.toLowerCase());
  if (!host.includes('.') || parsed.username || parsed.password) return null;
  return host;
}

export function logoDevUrl(websiteUrl: string | null | undefined, size: number): string | null {
  const publishable = getLogoDevPublishable();
  if (!publishable) return null;
  const domain = logoDomain(websiteUrl);
  if (!domain) return null;
  const params = new URLSearchParams({
    token: publishable,
    size: String(Math.min(size * 2, 800)),
    format: 'png',
    theme: 'auto',
    fallback: '404',
  });
  return `https://img.logo.dev/${encodeURIComponent(domain)}?${params.toString()}`;
}
