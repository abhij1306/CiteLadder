/**
 * Canonical research targets from a project's saved websites.
 *
 * A target is a registrable domain (ICANN public suffix list) or its `www`
 * host; child subdomains are not research targets. Readiness lists them for
 * selection; the review creator freezes the chosen one.
 */
import type { searchTargetSchema } from '@citeladder/contracts/search-intelligence';
import { getDomain } from 'tldts';

import type { z } from 'zod';

import { stripTrailing } from '../text-order.ts';
import { onlyOf } from '../lists.ts';

export type CanonicalTarget = z.output<typeof searchTargetSchema>;

/** The target for one saved website value, or null when it cannot be one. */
function targetOf(
  identity: string,
  label: string,
  value: string,
  sourceKind: 'owned' | 'competitor',
): CanonicalTarget | null {
  const candidate = value.trim();
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const hostname = stripTrailing(url.hostname, '.');
  const domain = getDomain(hostname, { allowPrivateDomains: false });
  if (!domain || (hostname !== domain && hostname !== `www.${domain}`)) return null;
  return {
    identity,
    label,
    registrable_domain: domain,
    hostname,
    origin: url.port ? `${url.protocol}//${hostname}:${url.port}` : `${url.protocol}//${hostname}`,
    source_kind: sourceKind,
  };
}

/** The primary website, then the owned domains in saved order, one per origin. */
export function ownedTargets(
  project: { name: string; website_url: string },
  ownedDomains: readonly { id: string; domain: string }[],
): CanonicalTarget[] {
  const candidates = [
    { identity: 'primary', value: project.website_url },
    ...ownedDomains.map((owned) => ({ identity: owned.id, value: owned.domain })),
  ];
  const byOrigin = new Map<string, CanonicalTarget>();
  for (const { identity, value } of candidates) {
    const target = targetOf(identity, project.name, value, 'owned');
    if (target && !byOrigin.has(target.origin)) byOrigin.set(target.origin, target);
  }
  return [...byOrigin.values()];
}

/** The research market: the saved preference, else the project's SERP market. */
export function searchMarket(
  project: { language_code: string; serp_language_code: string; serp_location_code: number },
  saved: { location_code?: number | null; language_code?: string | null },
) {
  return {
    location_code: saved.location_code ?? (project.serp_location_code || null),
    language_code: saved.language_code || project.serp_language_code || project.language_code,
  };
}

/** A competitor's target when it has exactly one valid saved domain. */
export function competitorTarget(
  competitor: { id: string; name: string },
  domains: readonly string[],
): CanonicalTarget | null {
  const saved = domains.filter((domain) => domain.trim());
  const only = onlyOf(saved);
  return only === undefined ? null : targetOf(competitor.id, competitor.name, only, 'competitor');
}
