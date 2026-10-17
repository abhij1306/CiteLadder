/** Domain identities and grounding redirects in recorded citation evidence. */
import { stripTrailing } from '../text-order.ts';

const GOOGLE_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const GROUNDING_REDIRECT_MARKER = 'grounding-api-redirect';

/** Lowercase host without www., accepting a bare domain or an absolute URL. */
export function normalizeDomain(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    return url.hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
}

export function domainMatches(candidate: unknown, target: unknown): boolean {
  const left = normalizeDomain(candidate);
  const right = normalizeDomain(target);
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`)));
}

/** Redirect tokens are not publisher identities. Matched on the parsed host,
 * never as a substring, so a publisher named after the marker keeps its identity.
 */
export function isGroundingRedirect(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = stripTrailing(url.hostname, '.');
    return (
      host === GOOGLE_REDIRECT_HOST ||
      host.endsWith(`.${GOOGLE_REDIRECT_HOST}`) ||
      host === GROUNDING_REDIRECT_MARKER
    );
  } catch {
    return false;
  }
}
