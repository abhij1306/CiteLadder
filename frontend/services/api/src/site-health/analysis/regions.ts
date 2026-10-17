/**
 * Structural page regions: the primary content region, chrome landmarks and
 * repeated card lists. Nothing here decides what a page is; it reports what is
 * present and where, so later extractors read the page's own content rather
 * than its navigation, footer or recommendation carousels.
 */
import {
  ancestors,
  attribute,
  childElements,
  elements,
  hasAttribute,
  parentElement,
  textContent,
  textNodes,
  type HtmlElement,
  type HtmlNode,
  type HtmlText,
} from '../../web-evidence/html.ts';
import { onlyOf } from '../../lists.ts';
import { regionPolicy as r, limits, squash } from './policy.ts';
import { comparableUrl } from './indexing.ts';

const EXCLUDED_TAGS = new Set(r.excluded_tags);
const NON_RENDERED_TAGS = new Set(r.non_rendered_tags);
const EXCLUDED_ROLES = new Set(r.excluded_roles);
const HIDDEN_ARIA = new Set(r.hidden_aria_values);
const RICH_TEXT_TAGS = new Set(r.rich_text_container_tags);
const RICH_TEXT_TOKENS = new Set(r.rich_text_container_tokens);
const CARD_ITEM_EXCLUDED_TAGS = new Set(r.card_item_excluded_tags);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const REGION_BY_TAG: Record<string, string> = {
  nav: 'nav',
  header: 'header',
  footer: 'footer',
  aside: 'aside',
  main: 'main',
  article: 'main',
};
const REGION_BY_ROLE: Record<string, string> = {
  navigation: 'nav',
  banner: 'header',
  contentinfo: 'footer',
  complementary: 'aside',
  main: 'main',
};
export const CHROME_REGIONS = new Set(['nav', 'header', 'footer', 'aside']);

export const role = (node: HtmlElement) => attribute(node, 'role').trim().toLowerCase();
const isHidden = (node: HtmlElement) =>
  r.hidden_attribute_names.some((name) => hasAttribute(node, name)) ||
  HIDDEN_ARIA.has(attribute(node, 'aria-hidden').trim().toLowerCase());
const isMainLandmark = (node: HtmlElement) =>
  node.tagName === 'main' || node.tagName === 'article' || role(node) === 'main';

/** Whether a header belongs to the page's own main/article content. */
function headerIsPageOwned(node: HtmlElement) {
  let depth = 0;
  for (const ancestor of ancestors(node)) {
    if (++depth > r.max_ancestor_depth) return false;
    if (isMainLandmark(ancestor)) return true;
  }
  return false;
}
function excludedSelf(node: HtmlElement) {
  return (
    EXCLUDED_TAGS.has(node.tagName) ||
    EXCLUDED_ROLES.has(role(node)) ||
    isHidden(node) ||
    (node.tagName === 'header' && !headerIsPageOwned(node))
  );
}

const excludedCache = new WeakMap<HtmlElement, boolean>();
/** Whether the element or any ancestor is chrome, non-rendered or hidden. */
function insideExcluded(node: HtmlElement): boolean {
  const cached = excludedCache.get(node);
  if (cached !== undefined) return cached;
  const parent = parentElement(node);
  const result = excludedSelf(node) || (parent !== null && insideExcluded(parent));
  excludedCache.set(node, result);
  return result;
}

/** Whether the element is outside every region-excluded subtree; fails closed past the depth bound. */
export function regionNodeIsVisible(node: HtmlElement): boolean {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < r.max_ancestor_depth; depth++) {
    if (!current) return true;
    if (excludedSelf(current)) return false;
    current = parentElement(current);
  }
  return current === null;
}

/** Whether an element is outside non-rendered or explicitly hidden subtrees. */
export function nodeIsRendered(node: HtmlElement): boolean {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < r.max_ancestor_depth && current; depth++) {
    if (NON_RENDERED_TAGS.has(current.tagName) || isHidden(current)) return false;
    current = parentElement(current);
  }
  return true;
}

/** Text nodes in `node` that the region contract considers visible. */
export function* visibleTextNodes(node: HtmlNode): Generator<HtmlText> {
  for (const text of textNodes(node)) {
    const parent = parentElement(text);
    if (!parent || !insideExcluded(parent)) yield text;
  }
}

export function outsideContainers(node: HtmlNode, containers: ReadonlySet<HtmlElement>) {
  if (!containers.size) return true;
  let current: HtmlNode | null = node;
  for (let depth = 0; depth < r.max_ancestor_depth && current; depth++) {
    if (containers.has(current as HtmlElement)) return false;
    current = parentElement(current);
  }
  return true;
}

/** Visible text of `node`, skipping the given containers, bounded in size. */
export function regionText(node: HtmlNode, excluded: ReadonlySet<HtmlElement> = new Set()) {
  const collected: string[] = [];
  let size = 0;
  for (const part of visibleTextNodes(node)) {
    if (excluded.size && !outsideContainers(part, excluded)) continue;
    const chunk = part.value.trim();
    if (!chunk) continue;
    collected.push(chunk);
    size += chunk.length + 1;
    if (size >= r.max_text_chars) break;
  }
  return collected.join(' ');
}

type PrimaryRegion = { node: HtmlNode; source: string };

function candidateRank(node: HtmlElement, source: string) {
  let headings = 0;
  let seen = 0;
  for (const heading of elements(node)) {
    if (heading === node || !HEADINGS.has(heading.tagName)) continue;
    if (++seen > r.max_primary_candidates) break;
    if (regionNodeIsVisible(heading)) headings++;
  }
  let chars = 0;
  for (const part of visibleTextNodes(node)) {
    chars += part.value.trim().length;
    if (chars >= r.primary_rank_text_chars) {
      chars = r.primary_rank_text_chars;
      break;
    }
  }
  return [Number(headings > 0), headings, chars, Number(source === 'main')];
}
const rankAbove = (left: number[], right: number[]) => {
  for (let index = 0; index < left.length; index++)
    if (left[index] !== right[index]) return left[index]! > right[index]!;
  return false;
};

/**
 * The strongest visible main/article candidate, else `<body>`. Invalid pages
 * often carry several `<main>` elements for drawers and overlays, so ties are
 * broken by page-content evidence rather than document order.
 */
function primaryRegion(root: HtmlNode): PrimaryRegion {
  const eligible: { node: HtmlElement; source: string }[] = [];
  for (const node of elements(root)) {
    if (!isMainLandmark(node) || !regionNodeIsVisible(node)) continue;
    eligible.push({
      node,
      source: node.tagName === 'article' && role(node) !== 'main' ? 'article' : 'main',
    });
    if (eligible.length >= r.max_primary_candidates) break;
  }
  const only = onlyOf(eligible);
  if (only) return only;
  let best: { node: HtmlElement; source: string; rank: number[] } | undefined;
  for (const candidate of eligible) {
    const rank = candidateRank(candidate.node, candidate.source);
    if (!best || rankAbove(rank, best.rank)) best = { ...candidate, rank };
  }
  if (best) return { node: best.node, source: best.source };
  const body = elements(root, 'body').next().value;
  return body ? { node: body, source: 'body_minus_chrome' } : { node: root, source: 'root' };
}

/** The landmark region an element sits in; chrome is identified by the DOM, not by repetition. */
export function elementRegion(node: HtmlElement): string {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < r.max_ancestor_depth && current; depth++) {
    const byRole = REGION_BY_ROLE[role(current)];
    if (byRole) return byRole;
    if (current.tagName === 'header' && headerIsPageOwned(current)) return 'main';
    const byTag = REGION_BY_TAG[current.tagName];
    if (byTag) return byTag;
    current = parentElement(current);
  }
  return 'other';
}

const identityTokens = (node: HtmlElement, names: readonly string[]) =>
  new Set(
    names
      .map((name) => attribute(node, name))
      .join(' ')
      .toLowerCase()
      .replaceAll('_', '-')
      .split(/\s+/u)
      .filter(Boolean),
  );
export const hasRichTextToken = (node: HtmlElement) =>
  [...identityTokens(node, ['id', 'class', 'data-testid'])].some((token) =>
    RICH_TEXT_TOKENS.has(token),
  );

type CardShape = { tag: string; children: Set<string> };
const containsLink = (node: HtmlElement) => !elements(node, 'a').next().done;
const compatible = (left: CardShape, right: CardShape) =>
  left.tag === right.tag &&
  ([...left.children].every((tag) => right.children.has(tag)) ||
    [...right.children].every((tag) => left.children.has(tag)));

function isCardList(candidate: HtmlElement) {
  if (RICH_TEXT_TAGS.has(candidate.tagName)) return false;
  // A wrapper around the page identity is not a repeated item collection.
  if ([...elements(candidate, 'h1')].some(regionNodeIsVisible)) return false;
  const counts = new Map<string, { shape: CardShape; count: number }>();
  for (const child of childElements(candidate)) {
    if (CARD_ITEM_EXCLUDED_TAGS.has(child.tagName) || !containsLink(child)) continue;
    const tags = childElements(child)
      .slice(0, r.shape_max_children)
      .map((item) => item.tagName);
    const key = `${child.tagName}|${tags.join(',')}`;
    const entry = counts.get(key) ?? {
      shape: { tag: child.tagName, children: new Set(tags) },
      count: 0,
    };
    entry.count++;
    counts.set(key, entry);
  }
  const shapes = [...counts.values()];
  return shapes.some(
    ({ shape }) =>
      shapes
        .filter((other) => compatible(shape, other.shape))
        .reduce((sum, other) => sum + other.count, 0) >= r.list_min_items,
  );
}

function headingNamesAnotherDocument(heading: HtmlElement, finalUrl: string) {
  const headingText = squash(textContent(heading));
  if (!headingText) return false;
  for (const anchor of elements(heading, 'a')) {
    if (squash(textContent(anchor)) !== headingText) continue;
    try {
      const target = new URL(attribute(anchor, 'href'), finalUrl);
      if (
        ['http:', 'https:'].includes(target.protocol) &&
        comparableUrl(target.href) !== comparableUrl(finalUrl)
      )
        return true;
    } catch {
      // An unusable link cannot establish an excerpt's target document.
    }
  }
  return false;
}

/** A featured article whose heading names another document is an excerpt, even on its own. */
function linkedArticleExcerpt(node: HtmlElement, finalUrl: string) {
  if (node.tagName !== 'article') return false;
  let scanned = 0;
  for (const heading of elements(node)) {
    if (++scanned > r.max_containers_scanned) break;
    if (!HEADINGS.has(heading.tagName) || !regionNodeIsVisible(heading)) continue;
    return heading.tagName !== 'h1' && headingNamesAnotherDocument(heading, finalUrl);
  }
  return false;
}

const isRecommendation = (node: HtmlElement) => {
  const identity = squash(
    ['id', 'class', 'aria-label', 'data-testid']
      .map((name) => attribute(node, name))
      .join(' ')
      .toLowerCase(),
  ).replaceAll(' ', '-');
  return r.content_recommendation_tokens.some((token) => identity.includes(token));
};

/** Repeated item collections, recommendation modules and isolated linked article excerpts. */
function cardListContainers(region: HtmlNode, finalUrl: string): HtmlElement[] {
  const containers: HtmlElement[] = [];
  const excerpts: HtmlElement[] = [];
  let scanned = 0;
  for (const candidate of elements(region)) {
    if (++scanned > r.max_containers_scanned) break;
    if (candidate === region) continue;
    if (linkedArticleExcerpt(candidate, finalUrl)) excerpts.push(candidate);
    if (isCardList(candidate) || isRecommendation(candidate)) containers.push(candidate);
  }
  // Repeated sections can resemble cards when each contains links. Keep the
  // actual nested collections without excluding their section/page wrappers.
  const wrappers = new Set<HtmlElement>();
  for (const container of containers) {
    let depth = 0;
    for (const ancestor of ancestors(container)) {
      if (++depth > r.max_ancestor_depth || ancestor === region) break;
      wrappers.add(ancestor);
    }
  }
  return [
    ...containers.filter((container) => !wrappers.has(container) || isRecommendation(container)),
    ...excerpts,
  ];
}

/** The primary region and its repeated card lists, resolved once per page. */
export type PageScope = {
  root: HtmlNode;
  region: HtmlNode;
  source: string;
  finalUrl: string;
  cards: ReadonlySet<HtmlElement>;
};
export function pageScope(root: HtmlNode, finalUrl: string): PageScope {
  const { node, source } = primaryRegion(root);
  return {
    root,
    region: node,
    source,
    finalUrl,
    cards: new Set(cardListContainers(node, finalUrl)),
  };
}

function containerLabel(container: HtmlElement) {
  const explicit = squash(attribute(container, 'aria-label'));
  if (explicit) return explicit;
  for (const heading of elements(container)) {
    if (heading === container || !['h1', 'h2', 'h3'].includes(heading.tagName)) continue;
    const text = squash(textContent(heading));
    if (text) return text;
  }
  const parent = parentElement(container);
  if (parent) {
    const siblings = childElements(parent);
    for (const sibling of siblings.slice(0, siblings.indexOf(container)).toReversed())
      if (['h1', 'h2', 'h3'].includes(sibling.tagName)) return squash(textContent(sibling));
  }
  return '';
}

/** A bounded, serializable name for a collection: its tag and semantic label, never selectors. */
export function containerName(container: HtmlElement) {
  return {
    tag: container.tagName.slice(0, 32),
    label: containerLabel(container).slice(0, limits.heading_chars),
  };
}

function hasAncestor(node: HtmlElement, ancestor: HtmlElement) {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < r.max_ancestor_depth && current; depth++) {
    if (current === ancestor) return true;
    current = parentElement(current);
  }
  return false;
}
function targetsContainer(node: HtmlElement, container: HtmlElement) {
  const id = attribute(container, 'id').trim();
  if (!id) return false;
  const references = ['aria-controls', 'aria-owns', 'for', 'href']
    .map((name) => attribute(node, name))
    .join(' ')
    .split(/\s+/u)
    .map((token) => token.replace(/^#+/u, ''));
  return references.includes(id);
}
function labelsContainer(node: HtmlElement, container: HtmlElement) {
  const id = attribute(node, 'id').trim();
  const references = [
    ...attribute(container, 'aria-labelledby').split(/\s+/u),
    ...attribute(container, 'aria-describedby').split(/\s+/u),
  ];
  if (id && references.includes(id)) return true;
  const label = containerLabel(container).toLowerCase();
  const nodeLabel = ['aria-label', 'title', 'name']
    .map((name) => attribute(node, name))
    .join(' ')
    .toLowerCase();
  return label.length >= 3 && nodeLabel.includes(label);
}
const nearAncestors = (node: HtmlElement) => {
  const chain: HtmlElement[] = [];
  for (
    let current: HtmlElement | null = node;
    current && chain.length < 3;
    current = parentElement(current)
  )
    chain.push(current);
  return chain;
};
function adjacentBranches(node: HtmlElement, container: HtmlElement) {
  const right = nearAncestors(container);
  for (const left of nearAncestors(node)) {
    const parent = parentElement(left);
    if (!parent) continue;
    const siblings = childElements(parent);
    const position = siblings.indexOf(left);
    for (const candidate of right)
      if (
        parentElement(candidate) === parent &&
        Math.abs(siblings.indexOf(candidate) - position) === 1
      )
        return true;
  }
  return false;
}

/** How an affordance relates to a collection, or '' when it does not. */
export function structuralRelation(node: HtmlElement, container: HtmlElement) {
  if (hasAncestor(node, container)) return 'contained';
  if (hasAncestor(container, node)) return 'contains';
  if (targetsContainer(node, container)) return 'targets';
  if (labelsContainer(node, container)) return 'labelled';
  if (adjacentBranches(node, container)) return 'adjacent';
  return '';
}

/** Whether `node` is visible, outside `containers`, and inside `region` within the depth bound. */
export function pageOwned(
  node: HtmlElement,
  region: HtmlNode,
  containers: ReadonlySet<HtmlElement>,
) {
  if (!outsideContainers(node, containers) || !regionNodeIsVisible(node)) return false;
  let current: HtmlNode | null = node;
  for (let depth = 0; depth < r.max_ancestor_depth && current; depth++) {
    if (current === region) return true;
    current = parentElement(current);
  }
  return false;
}
