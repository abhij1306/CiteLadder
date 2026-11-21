import { policy } from '../config.ts';
import {
  anchorElements,
  attribute,
  documentBaseUrl,
  elements,
  textContent,
  type HtmlNode,
} from '../web-evidence/html.ts';
import { classifyUrlAdmission, type Admission, type Scope } from './url-admission.ts';
import { canonicalIdentity, canonicalUrl } from './url-identity.ts';

const crawlPolicy = policy.site_health.crawl;
const NON_NAVIGABLE = policy.site_health.page_analysis.facts.non_navigable_href_prefixes;
const TRACKING = new Set(policy.site_health.tracking_params);

export type DiscoveredLink = {
  admission: Admission & { url: string };
  ordinal: number;
  rewriteReason: string;
  rewriteVersion: string;
};

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

export function linkTargetUrl(href: string, baseUrl: string) {
  return canonicalUrl(rewriteHref(href) ?? href, baseUrl);
}

export function discoveryLinks(root: HtmlNode, pageUrl: string, scope: Scope, maxLinks: number) {
  const baseUrl = documentBaseUrl(root, pageUrl);
  const titleNode = elements(root, 'title').next().value;
  const title = titleNode ? textContent(titleNode).slice(0, 1024) : '';
  const links: DiscoveredLink[] = [];
  const seen = new Set<string>();
  for (const { anchor } of anchorElements(root)) {
    if (links.length >= maxLinks) break;
    const link = admitHref(attribute(anchor, 'href').trim(), baseUrl, scope);
    if (!link || seen.has(link.admission.hash)) continue;
    seen.add(link.admission.hash);
    links.push({ ...link, ordinal: links.length });
  }
  return { title, links };
}

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
