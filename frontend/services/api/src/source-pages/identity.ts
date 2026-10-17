import { canonicalPage, hash } from '../traffic/normalization.ts';
import { isGroundingRedirect } from '../analysis/domains.ts';
import { policy } from '../config.ts';

/** Citation URL identity is offline; unresolved redirects wait for the inspector. */
export function citationIdentity(url: string, providerResolved = false) {
  const raw = url.trim();
  const canonical = raw && !isGroundingRedirect(raw) ? canonicalPage(raw) : null;
  return {
    canonical_url: canonical,
    url_hash: canonical ? hash(canonical) : null,
    resolved_url: canonical && providerResolved ? raw : null,
    url_identity_method: canonical
      ? policy.audits.url_identity.verbatim
      : policy.audits.url_identity.unresolved,
    url_identity_version: policy.audits.url_identity.version,
  };
}
