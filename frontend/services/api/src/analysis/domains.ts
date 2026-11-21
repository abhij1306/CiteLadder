import { getDomain } from 'tldts';

import { policy } from '../config.ts';
import { stripLeading, stripTrailing } from '../text-order.ts';

export function normalizeDomain(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    return stripLeading(stripTrailing(url.hostname.toLowerCase(), '.'), '.').replace(/^www\./u, '');
  } catch {
    return '';
  }
}

export function siteDomain(value: unknown): string | null {
  const host = normalizeDomain(value);
  if (!host) return null;
  const platform = policy.discovery.constants.shared_platform_domains.find((domain) =>
    host.endsWith(`.${domain}`),
  );
  if (platform)
    return host
      .split('.')
      .slice(-(platform.split('.').length + 1))
      .join('.');
  return getDomain(host, { allowPrivateDomains: true });
}

export function domainMatches(candidate: unknown, target: unknown): boolean {
  const left = normalizeDomain(candidate);
  const right = normalizeDomain(target);
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`)));
}

export function isGroundingRedirect(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = stripTrailing(url.hostname, '.');
    return policy.source_pages.redirect_hosts.some(
      (redirect) => host === redirect || host.endsWith(`.${redirect}`),
    );
  } catch {
    return false;
  }
}
