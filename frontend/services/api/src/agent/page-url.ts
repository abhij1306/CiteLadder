/** The project page a person's message names, read from its words alone. */
import { normalizeDomain as hostOf } from '../analysis/domains.ts';
import { stripLeading, stripTrailing } from '../text-order.ts';

const QUOTES = '<>"\'`()[]';
/**
 * The first address in the person's message on the project's own site, with
 * or without a scheme or `www.`: the page the request is about. Each word is
 * read apart; an email (`name@site.com`) or another site's URL is never a target.
 */
export function requestedPageUrl(request: string, website: string) {
  const site = hostOf(website);
  if (!site) return '';
  for (const word of request.split(/\s+/u)) {
    const bare = stripTrailing(stripLeading(word, QUOTES), `${QUOTES}.,;:!?`);
    // A query or fragment never names another page, and crawled URLs carry none.
    const cut = bare.search(/[?#]/u);
    const url = cut < 0 ? bare : bare.slice(0, cut);
    if (!url.includes('.') || url.includes('@')) continue;
    const absolute = /^https?:\/\//iu.test(url) ? url : `https://${url}`;
    if (hostOf(absolute) === site) return absolute;
  }
  return '';
}
