/**
 * Deterministic page-kind classification by evidence tier, not summed weights.
 * The highest tier that produced evidence decides, so one decisive structural
 * observation is never outvoted by several weak signals, and `classified_by`
 * always names the single signal that chose the kind. Structured data is the
 * page's claim about itself and never decides alone.
 */
import { compareText } from '../../text-order.ts';
import { firstOf } from '../../lists.ts';
import { documentUrl, isHomepagePath, normalizedPath, routeSignal } from '../routes.ts';
import { analysisPolicy, limits } from './policy.ts';
import { observedQuestionCount } from './questions.ts';
import { list, record, text, textList, type Facts } from './read-facts.ts';

const c = analysisPolicy.classification;
const SIGNAL_TIERS: Record<string, string> = c.signal_tiers;
const TIER_CONFIDENCE: Record<string, string> = c.tier_confidence;
const SIGNAL_ORDER = [
  'primary_product_entity',
  'primary_listing_structure',
  'primary_location_entity',
  'root_path',
  'path_pattern',
  'documentation_context',
  'service_capability_expression',
  'content_heuristic',
  'semantic_title',
  'structured_data',
];
const DECISIVE_AFFORDANCES = new Set(['result_count', 'sort', 'filter', 'facet', 'empty_state']);
const BOUND_RELATIONS = new Set(['contained', 'contains', 'targets', 'labelled', 'adjacent']);
const TECHNICAL_TOKENS = new Set([
  'api',
  'authentication',
  'configuration',
  'endpoint',
  'install',
  'parameter',
  'reference',
  'request',
  'response',
  'sdk',
]);
const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];

type Signal = { signal: string; page_kind: string; tier: string; detail: string };
const signal = (name: string, pageKind: string, detail: string): Signal => ({
  signal: name,
  page_kind: pageKind,
  tier: SIGNAL_TIERS[name] ?? 'semantic',
  detail: detail.slice(0, limits.signal_detail_chars),
});
const tierIndex = (tier: string) => c.tiers.indexOf(tier);

/** The page kind structured data alone suggests, most specific type first. */
function schemaSuggestion(facts: Facts): [string, string] | null {
  const types = new Set(textList(record(facts.structured_data).types));
  for (const [type, kind] of c.schema_type_map) {
    if (type === undefined || !types.has(type)) continue;
    if (kind === undefined) throw new Error(`Expected a page kind for schema type ${type}`);
    return [kind, type];
  }
  return null;
}

/** A real buy box with a corroborator, or an own price under a product-detail heading. */
function productEvidence(facts: Facts) {
  const product = record(record(facts.entity).product);
  const purchase = Boolean(product.has_purchase_control);
  const variant = Boolean(product.has_variant_control);
  const sku = Boolean(product.has_sku_marker);
  if (purchase && (variant || sku)) return 'primary_buy_box';
  if (!product.has_primary_price) return '';
  if (!purchase) return product.has_product_detail_heading ? 'primary_price+product_heading' : '';
  const structured = record(facts.structured_data);
  const products = list(structured.blocks).filter(
    (block) => text(record(block).type) === 'Product',
  );
  const singleSchemaProduct =
    products.length === 1 &&
    (textList(structured.types).includes('Offer') ||
      list(record(structured.product).price).length > 0);
  const ogProduct = text(record(facts.open_graph)['og:type']).trim().toLowerCase() === 'product';
  return ogProduct || singleSchemaProduct ? 'primary_buy_box' : '';
}

/** A collection with a decisive affordance bound to it; pagination alone is navigation. */
function listingEvidence(facts: Facts) {
  const collection = record(record(record(facts.entity).listing).collection_evidence);
  const size = record(collection.container).item_count;
  if (
    typeof size !== 'number' ||
    !Number.isInteger(size) ||
    size < analysisPolicy.entity.listing_min_card_items
  )
    return '';
  const classes: string[] = [];
  for (const item of list(collection.affordances).map(record)) {
    const kind = text(item.class);
    if (
      DECISIVE_AFFORDANCES.has(kind) &&
      BOUND_RELATIONS.has(text(item.relation)) &&
      !classes.includes(kind)
    )
      classes.push(kind);
  }
  return classes.length ? `collection:${size} ${classes.join('+')}` : '';
}

function locationEvidence(facts: Facts, localRoute: boolean) {
  const location = record(record(facts.entity).location);
  if (!localRoute || location.address_entity_count !== 1) return '';
  return location.has_phone || location.has_hours ? 'single_address_entity' : '';
}

function structuralSignals(facts: Facts, route: Signal[]) {
  const found: Signal[] = [];
  const product = productEvidence(facts);
  if (product) found.push(signal('primary_product_entity', 'product', product));
  const listing = listingEvidence(facts);
  if (listing)
    found.push(
      signal(
        'primary_listing_structure',
        route.some((item) => item.page_kind === 'editorial_index') ? 'editorial_index' : 'category',
        listing,
      ),
    );
  const location = locationEvidence(
    facts,
    route.some((item) => item.page_kind === 'local'),
  );
  if (location) found.push(signal('primary_location_entity', 'local', location));
  return found;
}

function documentationContext(url: URL, facts: Facts) {
  if (!['docs', 'developer', 'developers'].includes(url.hostname.toLowerCase().split('.')[0]!))
    return '';
  const outline = list(facts.primary_heading_outline).map(record);
  const levels = new Set(
    outline.map((item) => item.level).filter((level) => typeof level === 'number'),
  );
  const context = textList(facts.link_context);
  const technical = [
    ...new Set(
      tokens(
        [
          ...outline.map((item) => text(item.text)),
          ...context,
          text(facts.direct_answer),
          text(facts.editorial_lead),
        ].join(' '),
      ),
    ),
  ]
    .filter((token) => TECHNICAL_TOKENS.has(token))
    .sort(compareText);
  const reasons: string[] = [];
  if (levels.has(1) && [...levels].some((level) => (level as number) > 1) && technical.length)
    reasons.push(`technical:${technical.slice(0, 3).join(',')}`);
  const navigation = context.join(' ').toLowerCase();
  if (
    ['api reference', 'developer guide', 'documentation'].some((token) =>
      navigation.includes(token),
    )
  )
    reasons.push('documentation_navigation');
  const breadcrumbs = textList(record(facts.commerce).breadcrumbs).flatMap(tokens);
  if (
    breadcrumbs.some((token) => ['api', 'developer', 'documentation', 'reference'].includes(token))
  )
    reasons.push('documentation_breadcrumb');
  return reasons.join('+');
}

function serviceExpression(facts: Facts) {
  const proposition = record(facts.entity_proposition);
  const required = [
    'identity',
    'provider',
    'named_capability',
    'audience_or_outcome',
    'next_action',
  ];
  return required.every((key) => text(proposition[key]).trim())
    ? 'provider+capability+audience_outcome+next_action'
    : '';
}

function contentHeuristic(facts: Facts) {
  const questions = observedQuestionCount(facts.question_answer_relationships);
  if (questions >= c.faq_min_headings)
    return signal('content_heuristic', 'faq', `question_answer_relationships:${questions}`);
  const authorship = record(facts.authorship);
  return authorship.visible_byline && authorship.visible_date
    ? signal('content_heuristic', 'article', 'byline_and_date')
    : null;
}

/** The page's own stated purpose: longest phrase wins, config order breaks ties. */
function titleSuggestion(path: string, facts: Facts) {
  const h1 = textList(record(facts.headings).h1_texts).slice(0, 1);
  const slug = (path.split('/').at(-1) ?? '').replaceAll(/[-_]/gu, ' ');
  const haystack = ` ${tokens([text(facts.title), ...h1, slug].filter(Boolean).join(' ')).join(' ')} `;
  if (!haystack.trim()) return null;
  let best: { length: number; index: number; kind: string; phrase: string } | null = null;
  // A lone generic word ("contact", "shipping") names products too ("Contact lenses"):
  // it counts only as a whole name (the slug, the H1, or the title before its site
  // suffix), while a phrase may appear anywhere.
  const names = new Set(
    [slug, ...h1, text(facts.title).split(/ [-:] |[|–—·]/u)[0] ?? ''].map((name) =>
      tokens(name).join(' '),
    ),
  );
  c.title_keywords.forEach(([kind, phrase], index) => {
    const single = !phrase!.includes(' ');
    if (single ? !names.has(phrase!) : !haystack.includes(` ${phrase} `)) return;
    if (!best || phrase!.length > best.length)
      best = { length: phrase!.length, index, kind: kind!, phrase: phrase! };
  });
  return best as { kind: string; phrase: string } | null;
}

function semanticSignals(url: URL, path: string, facts: Facts) {
  const found: Signal[] = [];
  const documentation = documentationContext(url, facts);
  if (documentation) found.push(signal('documentation_context', 'docs', documentation));
  const service = serviceExpression(facts);
  if (service) found.push(signal('service_capability_expression', 'service', service));
  const heuristic = contentHeuristic(facts);
  if (heuristic) found.push(heuristic);
  const title = titleSuggestion(path, facts);
  if (title) found.push(signal('semantic_title', title.kind, title.phrase));
  const schema = schemaSuggestion(facts);
  if (schema) found.push(signal('structured_data', schema[0], schema[1]));
  return found;
}

function classificationSignals(finalUrl: string, facts: Facts): [Signal[], string | null] {
  const url = documentUrl(finalUrl);
  if (!url) return [[], null];
  const contentType = text(facts.content_type).split(';')[0]!.trim().toLowerCase();
  if (contentType && !['text/html', 'application/xhtml+xml'].includes(contentType))
    return [[], null];
  const path = normalizedPath(url);
  const schema = schemaSuggestion(facts)?.[0] ?? null;
  // The root path is an exact fact: a homepage stays one even when it renders a product grid.
  if (isHomepagePath(path)) return [[signal('root_path', 'homepage', path || '/')], schema];
  const routed = routeSignal(path);
  const route = routed ? [signal('path_pattern', routed.kind, routed.pattern)] : [];
  return [
    [...structuralSignals(facts, route), ...route, ...semanticSignals(url, path, facts)],
    schema,
  ];
}

/** A winner only when the strongest non-schema evidence agrees on one kind. */
function winningSignal(matched: Signal[]) {
  const eligible = matched.filter((item) => item.signal !== 'structured_data');
  if (!eligible.length) return null;
  const best = Math.min(...eligible.map((item) => tierIndex(item.tier)));
  const top = eligible.filter((item) => tierIndex(item.tier) === best);
  if (new Set(top.map((item) => item.page_kind)).size > 1) return null;
  return top.reduce(
    (winner, item) =>
      SIGNAL_ORDER.indexOf(item.signal) < SIGNAL_ORDER.indexOf(winner.signal) ? item : winner,
    firstOf(top, 'a top-tier page-kind signal'),
  );
}

function alternatives(matched: Signal[], winner: string | null) {
  const candidates = new Map<string, { page_kind: string; tier: string; signals: string[] }>();
  for (const item of matched) {
    if (item.page_kind === winner) continue;
    const entry = candidates.get(item.page_kind) ?? {
      page_kind: item.page_kind,
      tier: item.tier,
      signals: [],
    };
    entry.signals.push(item.signal);
    candidates.set(item.page_kind, entry);
  }
  return [...candidates.values()]
    .sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || compareText(a.page_kind, b.page_kind))
    .slice(0, c.max_alternatives);
}

function otherReason(matched: Signal[], winner: Signal | null) {
  if (winner) return null;
  if (matched.some((item) => item.signal !== 'structured_data')) return c.other_reasons.conflict;
  return matched.length ? c.other_reasons.schema_only : c.other_reasons.no_signals;
}

/** Classify one page into the config taxonomy; malformed facts simply match fewer signals. */
export function classify(finalUrl: string, facts: Facts) {
  const [matched, schemaKind] = classificationSignals(finalUrl, facts);
  const winner = winningSignal(matched);
  const kind = winner?.page_kind ?? null;
  const tier = winner?.tier ?? 'semantic';
  let confidence = 'unknown';
  if (winner)
    confidence =
      tier === 'structural' && matched.some((item) => item.page_kind !== winner.page_kind)
        ? 'medium'
        : TIER_CONFIDENCE[tier]!;
  // Without observed page content (a client-rendered shell), a URL or title guess is weak evidence.
  const extraction = record(facts.extraction);
  const unobserved = extraction.state === 'unavailable' ? text(extraction.reason) : '';
  if (unobserved && winner && confidence !== 'unknown') confidence = 'low';
  return {
    page_kind: kind ?? 'other',
    evidence: {
      classifier_version: c.version,
      classified_by: winner?.signal ?? 'none',
      schema_suggested_type: schemaKind,
      confidence,
      tier: winner ? tier : '',
      signals: matched,
      alternatives: alternatives(matched, kind),
      conflicts: matched
        .filter((item) => kind !== null && item.page_kind !== kind)
        .map((item) => ({
          winner_page_kind: kind,
          conflicting_page_kind: item.page_kind,
          signal: item.signal,
          tier: item.tier,
          detail: item.detail,
        }))
        .slice(0, c.max_alternatives),
      other_reason: otherReason(matched, winner),
      content_unobserved: unobserved || null,
    },
  };
}
