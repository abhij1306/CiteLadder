import { createHash } from 'node:crypto';

import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import { policy } from '../config.ts';
import { publicUrl } from './safe-fetch.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
export type PageEvidence = {
  source_id: string;
  processing_version: string;
  url: string;
  title: string;
  description: string;
  text: string;
  links: { url: string; label: string }[];
  icons: string[];
};
const cfg = policy.brand_evidence;
const excluded = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas']);
function element(node: Node): node is Element {
  return 'tagName' in node;
}
function attr(node: Element, name: string) {
  return node.attrs.find((item) => item.name === name)?.value ?? '';
}
function textOf(node: Node): string {
  if (element(node) && excluded.has(node.tagName)) return '';
  if ('value' in node && node.nodeName === '#text') return node.value;
  return 'childNodes' in node ? node.childNodes.map(textOf).join(' ') : '';
}
const compact = (value: string) => value.replaceAll(/\s+/gu, ' ').trim();
function collectLink(node: Element, result: PageEvidence) {
  const href = attr(node, 'href');
  if (!href) return;
  try {
    const target = publicUrl(href, result.url);
    if (
      node.tagName === 'a' &&
      target.origin === new URL(result.url).origin &&
      result.links.length < cfg.max_navigation_links
    )
      result.links.push({ url: target.href, label: compact(textOf(node)) });
    if (
      node.tagName === 'link' &&
      attr(node, 'rel')
        .toLowerCase()
        .split(/\s+/u)
        .some((rel) => rel === 'icon' || rel.endsWith('-icon'))
    )
      result.icons.push(target.href);
  } catch {
    /* Invalid navigation is not evidence. */
  }
}
function collectElement(node: Element, result: PageEvidence) {
  if (node.tagName === 'title') result.title = compact(textOf(node));
  if (node.tagName === 'meta' && attr(node, 'name').toLowerCase() === 'description')
    result.description = attr(node, 'content');
  if (node.tagName === 'body') result.text = compact(textOf(node)).slice(0, cfg.max_page_chars);
  if (node.tagName === 'a' || node.tagName === 'link') collectLink(node, result);
}
export function extractPage(body: Buffer, url: string): PageEvidence {
  const root = parse(body.toString('utf8'));
  const result: PageEvidence = {
    source_id: createHash('sha256').update(url).update('\0').update(body).digest('hex'),
    processing_version: cfg.version,
    url,
    title: '',
    description: '',
    text: '',
    links: [],
    icons: [],
  };
  function visit(node: Node) {
    if (element(node)) {
      if (excluded.has(node.tagName)) return;
      collectElement(node, result);
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(root);
  return result;
}
function tokens(value: string) {
  return value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
}
function hasTerm(values: readonly string[], terms: readonly string[]) {
  return values.some((word) => terms.includes(word));
}
function labelFamily(label: string) {
  const words = label.toLowerCase().split(/\s+/u);
  const index = words.findIndex(
    (word, i) => i > 0 && i < words.length - 1 && (word === 'in' || word === 'at'),
  );
  return (index < 0 ? words : words.slice(0, index)).join(' ');
}
export function offeringLinks(pages: readonly PageEvidence[]) {
  const seen = new Set<string>();
  const candidates = pages.flatMap((page) =>
    page.links.map((link) => ({
      ...link,
      source: page.url,
      source_id: page.source_id,
      processing_version: page.processing_version,
    })),
  );
  const selected = candidates
    .filter((link) => {
      const url = new URL(link.url);
      const words = tokens(`${url.pathname} ${link.label}`);
      const label = link.label.toLowerCase();
      if (
        seen.has(link.url) ||
        cfg.navigation_verbs.includes(label) ||
        cfg.locale_labels.includes(label) ||
        link.label.length < cfg.offering_label_min_chars ||
        link.label.split(/\s+/u).length > cfg.offering_label_max_words ||
        hasTerm(words, cfg.utility_link_terms) ||
        hasTerm(words, cfg.editorial_link_terms) ||
        hasTerm(tokens(label), cfg.junk_label_terms) ||
        new RegExp(cfg.detail_path_pattern, 'iu').test(url.href) ||
        new RegExp(cfg.person_label_pattern, 'iu').test(label) ||
        url.pathname.split('/').filter(Boolean).length > cfg.offering_max_path_depth
      )
        return false;
      seen.add(link.url);
      return true;
    })
    .sort(
      (a, b) =>
        Number(hasTerm(tokens(new URL(b.url).pathname), cfg.offering_hub_terms)) -
        Number(hasTerm(tokens(new URL(a.url).pathname), cfg.offering_hub_terms)),
    );
  const prefixes = new Map<string, number>();
  const sourcePages = new Map<string, number>();
  const families = new Map<string, number>();
  return selected
    .filter((link) => {
      const prefix = new URL(link.url).pathname.split('/')[1] ?? '';
      const family = labelFamily(link.label);
      if (
        (prefixes.get(prefix) ?? 0) >= cfg.max_nodes_per_prefix ||
        (sourcePages.get(link.source) ?? 0) >= cfg.max_nodes_per_page ||
        (families.get(family) ?? 0) >= cfg.max_nodes_per_label_family
      )
        return false;
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
      sourcePages.set(link.source, (sourcePages.get(link.source) ?? 0) + 1);
      families.set(family, (families.get(family) ?? 0) + 1);
      return true;
    })
    .slice(0, cfg.max_offering_nodes);
}
