import { record } from '../db/json.ts';
import { linkUrl } from '../site-health/internal-link-pages.ts';

const NAVIGATION_REGIONS = new Set(['nav', 'header', 'footer', 'aside']);

/**
 * A later complete capture verifies an observed main-content link, never a
 * model score. The anchor was a suggestion the editor may reword, so any
 * main-content link to the destination satisfies the check.
 */
export function contextualLinkObserved(
  rawFacts: unknown,
  check: Record<string, unknown>,
): boolean | null {
  const facts = record(rawFacts);
  const capture = record(facts.extraction);
  const links = record(facts.links);
  if (
    capture.state !== 'available' ||
    capture.truncated ||
    facts.extractor_version !== check.extractor_version ||
    links.anchors_truncated === true
  )
    return null;
  const base = record(facts.delivery).final_url;
  if (
    !Array.isArray(links.anchors) ||
    typeof check.target_url !== 'string' ||
    typeof base !== 'string'
  )
    return null;
  const matching = links.anchors
    .map(record)
    .filter(
      (anchor) => typeof anchor.url === 'string' && linkUrl(anchor.url, base) === check.target_url,
    );
  if (matching.some((anchor) => anchor.region === 'main')) return true;
  // An unclassified region might be the article body: no confident "missing".
  if (matching.some((anchor) => !NAVIGATION_REGIONS.has(String(anchor.region)))) return null;
  return false;
}
