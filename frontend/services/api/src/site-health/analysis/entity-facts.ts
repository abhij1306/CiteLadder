/**
 * Primary-entity structure read from the page's own region: its own buy box,
 * its own collection with the controls bound to it, and a single location.
 * These are observations; the classifier decides what they mean.
 */
import {
  ancestors,
  attribute,
  childElements,
  elements,
  hasAttribute,
  parentElement,
  textContent,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { stripTrailing } from '../../text-order.ts';
import { analysisPolicy, limits, regionPolicy, squash } from './policy.ts';
import { isGenericItemLabel } from './copy.ts';
import {
  CHROME_REGIONS,
  containerName,
  elementRegion,
  outsideContainers,
  regionNodeIsVisible,
  role,
  regionText,
  structuralRelation,
  visibleTextNodes,
  type PageScope,
} from './regions.ts';

const e = analysisPolicy.entity;
const PRICE = new RegExp(e.price_pattern, 'i');
const RESULT_COUNT = new RegExp(e.result_count_pattern, 'i');
const SORT = new Set(e.sort_control_tokens);
const FILTER = new Set(e.filter_control_tokens);
const VARIANT = new Set(analysisPolicy.traits.variant_form_fields);
const SKU_ATTRIBUTES = new Set(e.sku_attribute_tokens);
const DETAIL_PHRASES = new Set(e.product_detail_heading_phrases);
const RESULT_TOKENS = new Set(['count', 'matches', 'result', 'results']);
const PAGINATION_TOKENS = new Set(['pager', 'pagination', 'next-page', 'previous-page']);
const EMPTY_STATE_TOKENS = new Set(['empty-state', 'no-results', 'nothing-found']);
const EMPTY_NOUNS = new Set(['result', 'results', 'item', 'items', 'product', 'products']);
const AFFORDANCE_TAGS = new Set([
  'a',
  'button',
  'fieldset',
  'form',
  'nav',
  'output',
  'p',
  'select',
  'span',
  'strong',
]);
const EXCLUDED_COLLECTION_TAGS = new Set(['aside', 'footer', 'header', 'nav']);
const EXCLUDED_COLLECTION_ROLES = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'navigation',
  'search',
]);
const EXPLICIT_LIST_ROLES = new Set(['feed', 'grid', 'list', 'listbox']);
const EXPLICIT_LIST_TOKENS = new Set(['catalog', 'grid', 'items', 'list', 'products', 'results']);

export function emptyEntityFacts() {
  return {
    region: { source: '', card_list_count: 0 },
    product: {
      has_primary_price: false,
      has_product_detail_heading: false,
      has_purchase_control: false,
      has_variant_control: false,
      has_sku_marker: false,
      brand_names: [] as string[],
    },
    listing: {
      largest_card_list_size: 0,
      distinct_card_list_targets: 0,
      has_result_count: false,
      has_sort_control: false,
      has_filter_control: false,
      has_facet_control: false,
      has_pagination: false,
      has_empty_state: false,
      collection_evidence: emptyCollection(),
    },
    location: { address_entity_count: 0, has_phone: false, has_hours: false },
  };
}
type Affordance = { class: string; relation: string; text: string };
const emptyCollection = () => ({
  container: { tag: '', label: '', item_count: 0, distinct_targets: 0 },
  affordances: [] as Affordance[],
  items: [] as { title: string; url: string }[],
});

const wordTokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
function normalizedTokens(value: string) {
  const lowered = value.toLowerCase();
  return new Set([
    ...wordTokens(lowered),
    ...lowered.split(/[^a-z0-9-]+/u).filter((chunk) => chunk.includes('-')),
  ]);
}
const attributeBlob = (node: HtmlElement) =>
  ['name', 'id', 'class', 'aria-label', 'data-testid', 'value']
    .map((name) => attribute(node, name))
    .join(' ')
    .toLowerCase()
    .slice(0, limits.meta_chars);
const intersects = (tokens: Set<string>, vocabulary: ReadonlySet<string>) =>
  [...tokens].some((token) => vocabulary.has(token));
const blobHas = (blob: string, vocabulary: ReadonlySet<string>) =>
  intersects(normalizedTokens(blob), vocabulary) ||
  [...vocabulary].some((token) => token.includes('-') && blob.includes(token));
const matchesTokens = (node: HtmlElement, vocabulary: ReadonlySet<string>) =>
  intersects(normalizedTokens(attributeBlob(node)), vocabulary);

/** Descendants matching `test` that are visible and outside page chrome. */
const find = (node: HtmlNode, test: (item: HtmlElement) => boolean) =>
  [...elements(node)].filter(
    (item) =>
      item !== node &&
      test(item) &&
      regionNodeIsVisible(item) &&
      !CHROME_REGIONS.has(elementRegion(item)),
  );

function hasPriceOutsideCards(page: PageScope) {
  let scanned = 0;
  for (const text of visibleTextNodes(page.region)) {
    if (++scanned > regionPolicy.max_containers_scanned) break;
    const chunk = text.value.trim();
    const parent = parentElement(text);
    if (!chunk || !PRICE.test(chunk) || !parent) continue;
    if (!CHROME_REGIONS.has(elementRegion(parent)) && outsideContainers(parent, page.cards))
      return true;
  }
  return false;
}

function brandNames(page: PageScope) {
  const names: string[] = [];
  for (const node of find(
    page.region,
    (item) => attribute(item, 'itemprop') === 'brand' || hasAttribute(item, 'data-brand'),
  )) {
    if (!outsideContainers(node, page.cards)) continue;
    const value = (attribute(node, 'data-brand') || textContent(node)).trim();
    if (value && !names.includes(value.slice(0, 256))) names.push(value.slice(0, 256));
  }
  return names.slice(0, 8);
}

/** A product-detail heading, or a disclosure toggle whose label leads with one. */
function hasDetailHeading(page: PageScope) {
  for (const node of find(page.region, (item) =>
    ['h2', 'h3', 'button', 'summary'].includes(item.tagName),
  )) {
    if (!outsideContainers(node, page.cards)) continue;
    const normalized = wordTokens(textContent(node)).join(' ');
    if (DETAIL_PHRASES.has(normalized)) return true;
    if (
      ['button', 'summary'].includes(node.tagName) &&
      [...DETAIL_PHRASES].some((phrase) => normalized.startsWith(`${phrase} `))
    )
      return true;
  }
  return false;
}

function hasPurchaseControl(page: PageScope) {
  const owned = (node: HtmlElement) => outsideContainers(node, page.cards);
  const forms = find(
    page.region,
    (item) => item.tagName === 'form' && hasAttribute(item, 'action'),
  );
  if (
    forms.some(
      (form) =>
        owned(form) &&
        e.cart_form_action_tokens.some((token) =>
          attribute(form, 'action').trim().toLowerCase().includes(token),
        ),
    )
  )
    return true;
  return find(
    page.region,
    (item) =>
      item.tagName === 'button' ||
      (item.tagName === 'input' && attribute(item, 'type') === 'submit') ||
      (item.tagName === 'a' && hasAttribute(item, 'href')),
  ).some((control) => {
    if (!owned(control)) return false;
    const blob = `${attributeBlob(control)} ${textContent(control).toLowerCase()}`;
    return e.cart_markers.some((marker) => blob.includes(marker));
  });
}

function implicitVariantLabel(control: HtmlElement, page: PageScope) {
  const id = attribute(control, 'id').trim();
  let depth = 0;
  for (const ancestor of ancestors(control)) {
    if (++depth > regionPolicy.max_ancestor_depth || ancestor === page.region) break;
    if (ancestor.tagName !== 'label') continue;
    const target = attribute(ancestor, 'for').trim();
    return (
      (!target || target === id) &&
      outsideContainers(ancestor, page.cards) &&
      regionNodeIsVisible(ancestor) &&
      intersects(normalizedTokens(regionText(ancestor)), VARIANT)
    );
  }
  return false;
}

function associatedVariantLabel(control: HtmlElement, page: PageScope) {
  const id = attribute(control, 'id').trim();
  const labelledBy = new Set(attribute(control, 'aria-labelledby').split(/\s+/u).filter(Boolean));
  for (const node of find(
    page.region,
    (item) =>
      (item.tagName === 'label' && id !== '' && attribute(item, 'for') === id) ||
      labelledBy.has(attribute(item, 'id')),
  ))
    if (
      outsideContainers(node, page.cards) &&
      intersects(normalizedTokens(regionText(node)), VARIANT)
    )
      return true;
  return false;
}

/** Only the nearest semantic radio group may provide a shared variant name. */
function variantRadioGroup(control: HtmlElement, page: PageScope) {
  if (control.tagName !== 'input' || attribute(control, 'type') !== 'radio') return false;
  let depth = 0;
  for (const ancestor of ancestors(control)) {
    if (++depth > regionPolicy.max_ancestor_depth || ancestor === page.region) break;
    if (ancestor.tagName !== 'fieldset' && !['group', 'radiogroup'].includes(role(ancestor)))
      continue;
    if (intersects(normalizedTokens(attribute(ancestor, 'aria-label')), VARIANT)) return true;
    if (associatedVariantLabel(ancestor, page)) return true;
    const legend = childElements(ancestor).find((node) => node.tagName === 'legend');
    return Boolean(
      ancestor.tagName === 'fieldset' &&
      legend &&
      regionNodeIsVisible(legend) &&
      intersects(normalizedTokens(regionText(legend)), VARIANT),
    );
  }
  return false;
}

/** A variant identity on the control, its associated label, or its semantic radio group. */
function variantIdentity(control: HtmlElement, page: PageScope) {
  return (
    matchesTokens(control, VARIANT) ||
    associatedVariantLabel(control, page) ||
    implicitVariantLabel(control, page) ||
    variantRadioGroup(control, page)
  );
}

/** A multi-option variant selector or explicitly named variant radio group. */
function hasVariantControl(page: PageScope) {
  for (const select of find(page.region, (item) => item.tagName === 'select')) {
    if (!outsideContainers(select, page.cards)) continue;
    if (matchesTokens(select, SORT) || matchesTokens(select, FILTER)) continue;
    if (!variantIdentity(select, page)) continue;
    if (find(select, (item) => item.tagName === 'option').length >= e.variant_min_options)
      return true;
  }
  const names = new Map<string, number>();
  for (const radio of find(
    page.region,
    (item) => item.tagName === 'input' && attribute(item, 'type') === 'radio',
  )) {
    const name = attribute(radio, 'name').trim().toLowerCase();
    if (outsideContainers(radio, page.cards) && name && variantIdentity(radio, page))
      names.set(name, (names.get(name) ?? 0) + 1);
  }
  return [...names.values()].some((count) => count >= e.variant_min_options);
}

function hasSkuMarker(page: PageScope) {
  return find(
    page.region,
    (item) =>
      attribute(item, 'itemprop') === 'sku' ||
      hasAttribute(item, 'data-sku') ||
      hasAttribute(item, 'id'),
  ).some(
    (node) =>
      outsideContainers(node, page.cards) &&
      (attribute(node, 'itemprop').trim().toLowerCase() === 'sku' ||
        node.attrs.some((item) => SKU_ATTRIBUTES.has(item.name.trim().toLowerCase()))),
  );
}

function isPagination(node: HtmlElement, blob: string) {
  const rel = normalizedTokens(attribute(node, 'rel'));
  return (
    ['next', 'prev', 'previous'].some((token) => rel.has(token)) ||
    blobHas(blob, PAGINATION_TOKENS) ||
    (node.tagName === 'nav' && attribute(node, 'aria-label').toLowerCase().includes('pagination'))
  );
}

/** Whether a node sits under chrome before reaching the region; pagination navs may pass. */
function insideExcludedCollection(node: HtmlElement, region: HtmlNode, allowPagination = false) {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < regionPolicy.max_ancestor_depth && current; depth++) {
    if (current === region) return false;
    const excluded =
      EXCLUDED_COLLECTION_TAGS.has(current.tagName) || EXCLUDED_COLLECTION_ROLES.has(role(current));
    const navigation = current.tagName === 'nav' || role(current) === 'navigation';
    if (
      excluded &&
      !(allowPagination && navigation && isPagination(current, attributeBlob(current)))
    )
      return true;
    current = parentElement(current);
  }
  return true;
}

function isResultCount(node: HtmlElement, blob: string) {
  const text = squash(textContent(node));
  if (!text || !RESULT_COUNT.test(text)) return false;
  return (
    node.tagName === 'output' ||
    role(node) === 'status' ||
    hasAttribute(node, 'aria-live') ||
    blobHas(blob, RESULT_TOKENS)
  );
}

function isEmptyState(node: HtmlElement, blob: string) {
  const parts = stripTrailing(squash(textContent(node).toLowerCase()), '.!')
    .split(' ')
    .filter(Boolean);
  const [first, second, third] = parts;
  const emptyNoun = second !== undefined && EMPTY_NOUNS.has(second);
  const counted = parts.length === 2 && first === '0' && emptyNoun;
  const none =
    (parts.length === 2 || (parts.length === 3 && (third === 'available' || third === 'found'))) &&
    first === 'no' &&
    emptyNoun;
  const nothing = parts.length === 2 && first === 'nothing' && second === 'found';
  return blobHas(blob, EMPTY_STATE_TOKENS) || counted || none || nothing;
}

function affordanceClass(node: HtmlElement) {
  const blob = attributeBlob(node);
  if (isResultCount(node, blob)) return 'result_count';
  if (matchesTokens(node, SORT)) return 'sort';
  if (matchesTokens(node, FILTER)) return normalizedTokens(blob).has('facet') ? 'facet' : 'filter';
  if (isPagination(node, blob)) return 'pagination';
  return isEmptyState(node, blob) ? 'empty_state' : '';
}
const couldBeAffordance = (node: HtmlElement) => {
  if (AFFORDANCE_TAGS.has(node.tagName)) return true;
  const blob = attributeBlob(node);
  return [RESULT_TOKENS, PAGINATION_TOKENS, EMPTY_STATE_TOKENS].some((vocabulary) =>
    blobHas(blob, vocabulary),
  );
};

function collectionAffordances(region: HtmlNode) {
  const found: { node: HtmlElement; kind: string }[] = [];
  let scanned = 0;
  for (const node of elements(region)) {
    if (++scanned > regionPolicy.max_containers_scanned) break;
    if (insideExcludedCollection(node, region, true) || !couldBeAffordance(node)) continue;
    const kind = affordanceClass(node);
    if (kind) found.push({ node, kind });
  }
  return found;
}

function isExplicitList(node: HtmlElement) {
  if (EXPLICIT_LIST_ROLES.has(role(node))) return true;
  if (!['div', 'ol', 'section', 'ul'].includes(node.tagName)) return false;
  const identity = ['id', 'class', 'aria-label'].map((name) => attribute(node, name)).join(' ');
  return wordTokens(identity).some((token) => EXPLICIT_LIST_TOKENS.has(token));
}

/** Repeated containers plus explicit list/grid owners, for binding empty states. */
function listingContainers(page: PageScope) {
  const containers = [...page.cards].filter((node) => !insideExcludedCollection(node, page.region));
  const known = new Set(page.cards);
  let scanned = 0;
  for (const node of elements(page.region)) {
    if (++scanned > regionPolicy.max_containers_scanned) break;
    if (known.has(node) || insideExcludedCollection(node, page.region) || !isExplicitList(node))
      continue;
    known.add(node);
    containers.push(node);
  }
  return containers;
}

/** A visible navigable target; item naming is assessed separately. */
function cardTarget(anchor: HtmlElement, finalUrl: string) {
  if (!regionNodeIsVisible(anchor)) return null;
  const href = attribute(anchor, 'href').trim();
  if (
    !href ||
    analysisPolicy.facts.non_navigable_href_prefixes.some((prefix) =>
      href.toLowerCase().startsWith(prefix),
    )
  )
    return null;
  try {
    const target = new URL(href, finalUrl);
    return ['http:', 'https:'].includes(target.protocol) ? target : null;
  } catch {
    return null;
  }
}

function cardTitle(anchor: HtmlElement) {
  const ariaLabel = squash(attribute(anchor, 'aria-label'));
  if (ariaLabel && !isGenericItemLabel(ariaLabel)) return ariaLabel;
  const label = squash(regionText(anchor));
  if (label && !isGenericItemLabel(label)) return label;
  const alternative = squash(
    [...elements(anchor, 'img')]
      .filter(regionNodeIsVisible)
      .map((image) => attribute(image, 'alt'))
      .join(' '),
  );
  return isGenericItemLabel(alternative) ? '' : alternative;
}

function cardObservation(container: HtmlElement, finalUrl: string) {
  let items = 0;
  const targets = new Set<string>();
  const details: { title: string; url: string }[] = [];
  for (const child of childElements(container)) {
    let hasTarget = false;
    for (const anchor of elements(child, 'a')) {
      const target = cardTarget(anchor, finalUrl);
      if (!target) continue;
      hasTarget = true;
      targets.add(target.href);
      const title = cardTitle(anchor);
      if (
        title &&
        details.length < limits.evidence_urls &&
        !details.some((row) => row.url === target.href)
      )
        details.push({
          title: title.slice(0, limits.heading_chars),
          url: target.href.slice(0, limits.url_chars),
        });
    }
    if (!hasTarget) continue;
    items++;
  }
  return { items, targets: targets.size, details };
}

function emptyStateBelongs(
  node: HtmlElement,
  container: HtmlElement,
  containers: Set<HtmlElement>,
) {
  let current: HtmlElement | null = node;
  for (let depth = 0; depth < regionPolicy.max_ancestor_depth && current; depth++) {
    if (containers.has(current)) return current === container;
    current = parentElement(current);
  }
  return false;
}

const evidenceText = (node: HtmlElement) =>
  squash(
    [...visibleTextNodes(node)]
      .map((part) => part.value.trim())
      .filter(Boolean)
      .join(' '),
  ).slice(0, limits.cta_text_chars);

function observeCollection(
  container: HtmlElement,
  affordances: { node: HtmlElement; kind: string }[],
  containers: Set<HtmlElement>,
  finalUrl: string,
) {
  const { items, targets, details } = cardObservation(container, finalUrl);
  const name = containerName(container);
  const found: Affordance[] = [];
  const seen = new Set<string>();
  for (const { node, kind } of affordances) {
    const relation = structuralRelation(node, container);
    if (!relation || (kind === 'empty_state' && !emptyStateBelongs(node, container, containers)))
      continue;
    if (seen.has(`${kind}|${relation}`)) continue;
    seen.add(`${kind}|${relation}`);
    found.push({ class: kind, relation, text: evidenceText(node) });
    if (found.length >= regionPolicy.shape_max_children) break;
  }
  const identity = `${name.label.toLowerCase()} ${attributeBlob(container)}`.replaceAll(' ', '-');
  return {
    evidence: {
      container: { ...name, item_count: items, distinct_targets: targets },
      affordances: found,
      items: details,
    },
    recommendation: analysisPolicy.regions.content_recommendation_tokens.some((token) =>
      identity.includes(token),
    ),
  };
}

/** The first item with the largest key, like a stable max. */
function maxBy<T>(items: T[], key: (item: T) => number[]): T | undefined {
  let best: T | undefined;
  let bestKey: number[] = [];
  for (const item of items) {
    const value = key(item);
    const greater = value.findIndex((part, index) => part !== bestKey[index]);
    if (best === undefined || (greater !== -1 && value[greater]! > bestKey[greater]!)) {
      best = item;
      bestKey = value;
    }
  }
  return best;
}

function listingFacts(page: PageScope) {
  const affordances = collectionAffordances(page.region);
  const containers = listingContainers(page);
  const containerSet = new Set(containers);
  const observations = containers.map((item) =>
    observeCollection(item, affordances, containerSet, page.finalUrl),
  );
  const size = (item: (typeof observations)[number]) => item.evidence.container;
  const largest = maxBy(observations, (item) => [
    size(item).item_count,
    size(item).distinct_targets,
  ]);
  const selected = maxBy(
    observations.filter((item) => !item.recommendation),
    (item) => [
      size(item).item_count,
      item.evidence.affordances.length,
      size(item).distinct_targets,
    ],
  );
  const evidence = selected?.evidence ?? emptyCollection();
  const classes = new Set(evidence.affordances.map((item) => item.class));
  return {
    largest_card_list_size: largest?.evidence.container.item_count ?? 0,
    distinct_card_list_targets: largest?.evidence.container.distinct_targets ?? 0,
    has_result_count: classes.has('result_count'),
    has_sort_control: classes.has('sort'),
    has_filter_control: classes.has('filter') || classes.has('facet'),
    has_facet_control: classes.has('facet'),
    has_pagination: classes.has('pagination'),
    has_empty_state:
      classes.has('empty_state') ||
      (!observations.length && affordances.some((item) => item.kind === 'empty_state')),
    collection_evidence: evidence,
  };
}

function locationFacts(region: HtmlNode) {
  return {
    address_entity_count: find(
      region,
      (item) => item.tagName === 'address' || attribute(item, 'itemprop') === 'address',
    ).length,
    has_phone:
      find(region, (item) => item.tagName === 'a' && attribute(item, 'href').startsWith('tel:'))
        .length > 0,
    has_hours:
      find(region, (item) =>
        ['openingHours', 'openingHoursSpecification'].includes(attribute(item, 'itemprop')),
      ).length > 0,
  };
}

/** Bounded primary-entity structure facts for one parsed document. */
export function entityFacts(page: PageScope) {
  return {
    region: { source: page.source, card_list_count: page.cards.size },
    product: {
      has_primary_price: hasPriceOutsideCards(page),
      has_product_detail_heading: hasDetailHeading(page),
      has_purchase_control: hasPurchaseControl(page),
      has_variant_control: hasVariantControl(page),
      has_sku_marker: hasSkuMarker(page),
      brand_names: brandNames(page),
    },
    listing: listingFacts(page),
    location: locationFacts(page.region),
  };
}
