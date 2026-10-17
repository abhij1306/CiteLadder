/** A page's in-scope links in document order: pure, so it runs on the interpretation pool. */
import { policy } from '../config.ts';
import {
  attribute,
  elements,
  textContent,
  type HtmlElement,
  type HtmlNode,
} from '../web-evidence/html.ts';
import { classifyUrlAdmission, type Admission, type Scope } from './url-admission.ts';
import { canonicalIdentity } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const NON_NAVIGABLE = policy.site_health.page_analysis.facts.non_navigable_href_prefixes;
const TRACKING = new Set(policy.site_health.tracking_params);

export type DiscoveredLink = {
  admission: Admission & { url: string };
  ordinal: number;
  rewriteReason: string;
  rewriteVersion: string;
};

/** Repair a positively identified encoded tracking-query delimiter (`/p%3Futm_source%3Dx`). */
function rewriteHref(href: string) {
  const match = /%3f/iu.exec(href);
  if (href.includes('?') || !match) return null;
  const query = href
    .slice(match.index + 3)
    .replaceAll(/%3d/giu, '=')
    .replaceAll(/%26/giu, '&');
  const separator = query.indexOf('=');
  if (separator < 0 || !TRACKING.has(query.slice(0, separator).toLowerCase())) return null;
  return `${href.slice(0, match.index)}?${query}`;
}

/** Every anchor in document order, template content included: discovery reads the unpruned page. */
function* anchors(root: HtmlNode): Generator<HtmlElement> {
  for (const element of elements(root)) {
    if (element.tagName === 'a') yield element;
    if (element.tagName === 'template' && 'content' in element)
      yield* anchors((element as HtmlElement & { content: HtmlNode }).content);
  }
}

/** The page title and its bounded, canonical, in-scope links in document order. */
export function discoveryLinks(root: HtmlNode, baseUrl: string, scope: Scope, maxLinks: number) {
  const titleNode = elements(root, 'title').next().value;
  const title = titleNode ? textContent(titleNode).slice(0, 1024) : '';
  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors(root)) {
    if (links.length >= maxLinks) break;
    const link = admitHref(attribute(anchor, 'href').trim(), baseUrl, scope);
    if (!link || seen.has(link.admission.hash)) continue;
    seen.add(link.admission.hash);
    links.push({ ...link, ordinal: links.length });
  }
  return { title, links };
}

/** One href's admission under the crawl scope, or null when it names no admissible page. */
function admitHref(
  href: string,
  baseUrl: string,
  scope: Scope,
): Omit<DiscoveredLink, 'ordinal'> | null {
  const lowered = href.toLowerCase();
  if (!href || NON_NAVIGABLE.some((prefix) => lowered.startsWith(prefix))) return null;
  const rewritten = rewriteHref(href);
  let target = href;
  try {
    // A rewritten href is canonicalized first, which drops the repaired tracking query.
    if (rewritten) target = canonicalIdentity(rewritten, baseUrl).url;
  } catch {
    return null;
  }
  const admission = classifyUrlAdmission(target, { ...scope, base: baseUrl });
  if (!admission.accepted || !admission.url) return null;
  return {
    admission: { ...admission, url: admission.url },
    rewriteReason: rewritten ? crawlPolicy.link_rewrite.reason : '',
    rewriteVersion: rewritten ? crawlPolicy.link_rewrite.version : '',
  };
}
