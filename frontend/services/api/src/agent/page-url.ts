import { normalizeDomain as hostOf } from '../analysis/domains.ts';
import { stripLeading, stripTrailing } from '../text-order.ts';

const QUOTES = '<>"\'`()[]';
export function requestedPageUrl(request: string, website: string) {
  const site = hostOf(website);
  if (!site) return '';
  for (const word of request.split(/\s+/u)) {
    const bare = stripTrailing(stripLeading(word, QUOTES), `${QUOTES}.,;:!?`);
    const cut = bare.search(/[?#]/u);
    const url = cut < 0 ? bare : bare.slice(0, cut);
    if (!url.includes('.') || url.includes('@')) continue;
    const absolute = /^https?:\/\//iu.test(url) ? url : `https://${url}`;
    if (hostOf(absolute) === site) return absolute;
  }
  return '';
}
