/** The one citation URL identity: `citations.url_hash` and `source_pages.url_hash` share it. */
import { getDomain } from 'tldts';

import { hash } from '../crypto-text.ts';
import { canonicalPage } from '../page-identity.ts';
import { isGroundingRedirect } from '../analysis/domains.ts';
import { policy } from '../config.ts';

/** A cited page's canonical URL, hash and registrable domain; null for a redirect token or non-page. */
export function pageIdentity(url: string) {
  const raw = url.trim();
  const canonical = raw && !isGroundingRedirect(raw) ? canonicalPage(raw) : null;
  if (!canonical) return null;
  const host = new URL(canonical).hostname;
  return { url: canonical, hash: hash(canonical), domain: getDomain(host) ?? host };
}

/** Citation URL identity is offline; unresolved redirects wait for the inspector. */
export function citationIdentity(url: string, providerResolved = false) {
  const identity = pageIdentity(url);
  return {
    canonical_url: identity?.url ?? null,
    url_hash: identity?.hash ?? null,
    resolved_url: identity && providerResolved ? url.trim() : null,
    url_identity_method: identity
      ? policy.audits.url_identity.verbatim
      : policy.audits.url_identity.unresolved,
    url_identity_version: policy.audits.url_identity.version,
  };
}
