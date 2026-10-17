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
 * 200 OK; we would rather 404 and let `<BrandLogo>`'s own initials show, since
 * those carry our accent colour and match the rest of the UI.
 */

import { getLogoDevPublishable } from '@/lib/config/env';

function stripTrailingDots(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 46) {
    end -= 1;
  }
  return value.slice(0, end);
}

/**
 * Registrable-ish domain for a site URL, or null when it is not usable.
 *
 * Deliberately lenient: Logo.dev resolves `www.` and most subdomain forms
 * itself, so this only strips the scheme/path and rejects what could never be a
 * public domain — rather than shipping a public-suffix list to the client.
 */
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
  // Needs a dot and no credentials/IP-literal weirdness to be a real site.
  if (!host.includes('.') || parsed.username || parsed.password) return null;
  return host;
}

/**
 * CDN URL for a domain's logo, or null when unusable / no token configured.
 *
 * `size` is doubled for crisp rendering on high-DPI screens, matching how the
 * avatar is displayed at 16–32 CSS px.
 */
export function logoDevUrl(websiteUrl: string | null | undefined, size: number): string | null {
  const publishable = getLogoDevPublishable();
  if (!publishable) return null;
  const domain = logoDomain(websiteUrl);
  if (!domain) return null;
  const params = new URLSearchParams({
    token: publishable,
    size: String(Math.min(size * 2, 800)),
    format: 'png',
    // Let the CDN pick a background that suits the viewer's colour scheme.
    theme: 'auto',
    // 404 instead of a grey monogram — see the module note.
    fallback: '404',
  });
  return `https://img.logo.dev/${encodeURIComponent(domain)}?${params.toString()}`;
}
