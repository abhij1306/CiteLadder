/** Content, identity, question and product readiness checks over persisted facts. */
import { compareText } from '../../text-order.ts';
import { analysisPolicy } from './policy.ts';
import { passFail } from './delivery-checks.ts';
import { isGenericItemLabel } from './copy.ts';
import type { CheckResult } from './indexing.ts';
import { isAnswerHeading } from './questions.ts';
import { count, list, record, records, text, textList, type Facts } from './read-facts.ts';

export type CompositeContract = {
  threshold: string;
  atoms: { name: string; required: boolean; condition: string }[];
};
type Atom = {
  name: string;
  outcome: string;
  required: boolean;
  condition: string;
  evidence: unknown;
};

/** An atom's outcome under its trait condition; an inapplicable atom is not a failure. */
function atomDetail(
  contract: CompositeContract,
  name: string,
  satisfied: boolean,
  evidence: unknown,
  traits: Set<string>,
): Atom {
  const atom = contract.atoms.find((item) => item.name === name);
  if (!atom) throw new Error(`Composite atom is not configured: ${name}`);
  const [prefix, trait] = atom.condition.split(':', 2);
  const applies =
    !atom.condition || (prefix === 'page_trait' ? traits.has(trait!) : !traits.has(trait!));
  let outcome = 'missing';
  if (!applies) outcome = 'not_applicable';
  else if (satisfied) outcome = 'satisfied';
  return { name: atom.name, outcome, required: atom.required, condition: atom.condition, evidence };
}
function compositeOutcome(contract: CompositeContract, atoms: Atom[]) {
  const applicable = atoms.filter((atom) => atom.outcome !== 'not_applicable');
  if (!applicable.length) return 'not_applicable';
  if (applicable.some((atom) => atom.required && atom.outcome === 'missing')) return 'missing';
  if (
    contract.threshold === 'all_required_and_applicable' &&
    applicable.some((atom) => atom.outcome === 'missing')
  )
    return 'partial';
  return 'satisfied';
}

function presentField(facts: Facts, field: string, lengthKey?: string): CheckResult {
  const value = text(facts[field]).trim();
  const evidence: Record<string, unknown> = { present: Boolean(value) };
  evidence[lengthKey ?? field] = lengthKey ? value.length : value;
  return [passFail(Boolean(value)), evidence];
}

function structuredDataPresent(facts: Facts): CheckResult {
  const sd = record(facts.structured_data);
  const blocks = count(sd.count);
  const declared = list(sd.declared_types);
  return [
    passFail(declared.length > 0),
    {
      block_count: blocks,
      has_json_ld: Boolean(sd.has_json_ld),
      has_microdata: Boolean(sd.has_microdata),
      types: list(sd.types),
      declared_types: declared,
    },
  ];
}

function openGraphPresent(facts: Facts): CheckResult {
  const og = record(facts.open_graph);
  const title = Boolean(text(og['og:title']).trim());
  const description = Boolean(text(og['og:description']).trim());
  return [
    passFail(title && description),
    {
      has_og_title: title,
      has_og_description: description,
      property_count: Object.keys(og).length,
    },
  ];
}

function visibleAttribution(facts: Facts): CheckResult {
  const authorship = record(facts.authorship);
  const visible = text(authorship.visible_byline).trim();
  const declared = text(authorship.declared_author).trim();
  const evidence: Record<string, unknown> = {
    visible_name: visible.slice(0, 256),
    visible_profile_url: text(authorship.visible_profile_url).trim().slice(0, 512),
    declared_name: declared.slice(0, 256),
    declared_source: text(authorship.declared_author_source).trim(),
  };
  if (visible) return ['satisfied', evidence];
  evidence.reason = declared ? 'declared_attribution_only' : 'visible_attribution_absent';
  return [declared ? 'partial' : 'missing', evidence];
}

function contentDatePresent(facts: Facts): CheckResult {
  const dates = record(facts.dates);
  const published = Boolean(text(dates.published).trim());
  const modified = Boolean(text(dates.modified).trim());
  const evidence: Record<string, unknown> = { has_published: published, has_modified: modified };
  if (!(published || modified)) evidence.reason = 'freshness_signal_missing';
  return [passFail(published || modified), evidence];
}

const DAY_MS = 86_400_000;
/**
 * The newest declared date against the audit time. An undated page is the date
 * check's finding, not this one's; a date that cannot be read stays unknown.
 */
function contentRecency(facts: Facts): CheckResult {
  const dates = record(facts.dates);
  const declared = [text(dates.published), text(dates.modified)].filter((value) => value.trim());
  if (!declared.length) return ['not_applicable', { reason: 'no_content_date' }];
  const parsed = declared.map((value) => Date.parse(value)).filter((time) => !Number.isNaN(time));
  const evidence: Record<string, unknown> = {
    declared_dates: declared,
    max_age_days: analysisPolicy.rules.content_recency_max_age_days,
  };
  if (!parsed.length) return ['unknown', { ...evidence, reason: 'content_date_unparseable' }];
  const audit = typeof facts.audit_time === 'string' ? Date.parse(facts.audit_time) : Number.NaN;
  if (Number.isNaN(audit)) return ['unknown', { ...evidence, reason: 'audit_time_unavailable' }];
  const ageDays = Math.floor((audit - Math.max(...parsed)) / DAY_MS);
  evidence.age_days = ageDays;
  if (ageDays < -analysisPolicy.rules.content_recency_future_tolerance_days)
    return ['unknown', { ...evidence, reason: 'content_date_in_future' }];
  if (ageDays <= analysisPolicy.rules.content_recency_max_age_days) return ['satisfied', evidence];
  return ['missing', { ...evidence, reason: 'content_not_recent' }];
}

const bareHost = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      ? url.hostname.toLowerCase().replace(/^www\./u, '')
      : '';
  } catch {
    return '';
  }
};
/** The organization links to profiles elsewhere (Wikidata, LinkedIn, ...) that confirm the entity. */
function entityProfiles(facts: Facts): CheckResult {
  const types = new Set(analysisPolicy.rules.organization_bearing_schema_types);
  const blocks = records(record(facts.structured_data).blocks).filter((block) =>
    types.has(text(block.type)),
  );
  if (!blocks.length) return ['not_applicable', { reason: 'no_expected_type_block' }];
  const site = bareHost(text(record(facts.delivery).final_url));
  const profiles = [
    ...new Set(
      blocks
        .flatMap((block) => textList(block.same_as))
        .filter((url) => {
          const host = bareHost(url);
          return host && host !== site && !host.endsWith(`.${site}`);
        }),
    ),
  ];
  return [
    passFail(profiles.length > 0),
    { profile_count: profiles.length, profiles: profiles.slice(0, 8) },
  ];
}

function sourceSupportPresent(facts: Facts): CheckResult {
  const support = record(facts.source_support);
  const sources = list(support.attached_sources);
  const ambiguous = count(support.ambiguous_source_count);
  const invalid = count(support.invalid_source_count);
  const evidence: Record<string, unknown> = {
    attached_sources: sources.slice(0, 24),
    attached_source_count: sources.length,
    ambiguous_source_count: ambiguous,
    invalid_source_count: invalid,
    context_reasons: list(support.context_reasons).slice(0, 8),
  };
  if (!support.primary_content_available)
    return ['unknown', { ...evidence, reason: 'primary_content_unavailable' }];
  if (sources.length) return ['satisfied', evidence];
  if (invalid) return ['missing', { ...evidence, reason: 'invalid_source_relationship' }];
  if (ambiguous) return ['unknown', { ...evidence, reason: 'ambiguous_source_attachment' }];
  return ['missing', { ...evidence, reason: 'source_support_absent' }];
}

function headingHierarchy(facts: Facts): CheckResult {
  if (!Array.isArray(facts.primary_heading_outline))
    return ['unknown', { scope: 'primary_content', reason: 'heading_outline_unavailable' }];
  if (
    facts.primary_heading_outline.some((item) => {
      const level = record(item).level;
      return typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6;
    })
  )
    return ['unknown', { scope: 'primary_content', reason: 'heading_level_invalid' }];
  const sections = records(facts.primary_heading_outline)
    .filter((item) => text(item.text).trim())
    .map((item) => ({ level: count(item.level), text: text(item.text).slice(0, 256) }));
  if (!sections.length)
    return [
      'unknown',
      {
        scope: 'primary_content',
        section_count: 0,
        sections: [],
        reason: 'section_context_missing',
      },
    ];
  const skips = sections.flatMap((section, index) => {
    const previous = sections[index - 1];
    return previous && section.level > previous.level + 1
      ? [{ from: previous.level, to: section.level, text: section.text }]
      : [];
  });
  return [
    passFail(skips.length === 0),
    {
      scope: 'primary_content',
      section_count: sections.length,
      sections: sections.slice(0, 24),
      skips: skips.slice(0, 24),
      reason: skips.length ? 'heading_levels_skipped' : '',
    },
  ];
}

function organizationIdentity(facts: Facts): CheckResult {
  const types = new Set(analysisPolicy.rules.organization_bearing_schema_types);
  const blocks = records(record(facts.structured_data).blocks).filter((block) =>
    types.has(text(block.type)),
  );
  const identities = blocks.flatMap((block) => {
    const name = text(block.name);
    const url = text(block.url);
    return name.trim() && url.trim() ? [{ name: name.slice(0, 256), url: url.slice(0, 512) }] : [];
  });
  return [
    passFail(identities.length > 0),
    {
      has_organization: blocks.length > 0,
      complete_identity_count: identities.length,
      identities: identities.slice(0, 4),
    },
  ];
}

const TRUST_TOKENS = new Set(['about', 'contact', 'privacy', 'policy', 'terms']);
const termsOf = (value: string) => value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
function trustPath(facts: Facts): CheckResult {
  const paths = records(record(facts.links).anchors)
    .filter((anchor) => anchor.is_internal)
    .flatMap((anchor) => {
      const url = text(anchor.url);
      const label = text(anchor.anchor_text);
      const path = url.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/]*/iu, '').split(/[?#]/u)[0] ?? '';
      return [...termsOf(path), ...termsOf(label)].some((term) => TRUST_TOKENS.has(term))
        ? [{ url: url.slice(0, 512), label: label.slice(0, 128) }]
        : [];
    });
  return [passFail(paths.length > 0), { trust_paths: paths.slice(0, 12), count: paths.length }];
}

const questionRelationships = (facts: Facts) =>
  records(facts.question_answer_relationships).filter((item) =>
    isAnswerHeading(text(item.question)),
  );
const relationshipSources = (items: Record<string, unknown>[]) =>
  [...new Set(items.map((item) => text(item.source)))].sort(compareText);

/** Every observed FAQ question needs a server-rendered answer. */
function answerFirst(facts: Facts): CheckResult {
  if (!Array.isArray(facts.question_answer_relationships))
    return ['unknown', { reason: 'question_relationships_unavailable' }];
  const relationships = questionRelationships(facts);
  if (!relationships.length) return ['unknown', { reason: 'no_question_answer_relationships' }];
  const answered = relationships.filter(
    (item) => item.answer_state === 'available' && text(item.answer).trim(),
  );
  const unavailable = relationships.filter((item) => item.answer_state === 'unavailable');
  const evidence: Record<string, unknown> = {
    question_count: relationships.length,
    answered_question_count: answered.length,
    relationship_sources: relationshipSources(relationships),
    unavailable_question_count: unavailable.length,
    reasons: [...new Set(relationships.map((item) => text(item.reason)).filter(Boolean))].sort(
      compareText,
    ),
  };
  if (unavailable.length && answered.length + unavailable.length === relationships.length)
    return ['unknown', { ...evidence, reason: 'question_answers_unavailable' }];
  if (answered.length === relationships.length) return ['satisfied', evidence];
  return ['missing', { ...evidence, reason: 'question_answer_missing' }];
}

function questionHeadings(facts: Facts): CheckResult {
  if (!Array.isArray(facts.question_answer_relationships))
    return ['unknown', { reason: 'question_relationships_unavailable' }];
  const relationships = questionRelationships(facts);
  if (!relationships.length) return ['unknown', { reason: 'no_question_answer_relationships' }];
  const unavailable = relationships.filter((item) => item.answer_state === 'unavailable').length;
  const evidence = {
    question_count: relationships.length,
    associated_region_count: relationships.length - unavailable,
    relationship_sources: relationshipSources(relationships),
  };
  return unavailable
    ? ['unknown', { ...evidence, reason: 'answer_regions_unavailable' }]
    : ['satisfied', evidence];
}

const productSignals = (facts: Facts) => ({
  entity: record(record(facts.entity).product),
  schema: record(record(facts.structured_data).product),
  commerce: record(facts.commerce),
});
const QUOTE_ACTIONS = ['request a quote', 'get a quote', 'request pricing'];
function quoteLed(facts: Facts) {
  const phrases = [
    ...textList(facts.cta_text),
    ...records(record(facts.links).anchors)
      .filter((anchor) => anchor.region === 'main')
      .map((anchor) => `${text(anchor.anchor_text)} ${text(anchor.url)}`),
  ];
  return phrases.some((value) =>
    QUOTE_ACTIONS.some((action) => value.toLowerCase().includes(action)),
  );
}

function productAnswerFacts(facts: Facts, contract: CompositeContract): CheckResult {
  const { entity, schema, commerce } = productSignals(facts);
  const price = Boolean(entity.has_primary_price) || list(schema.price).length > 0;
  const currency =
    list(schema.price_currency).length > 0 ||
    [...'$€£¥'].some((symbol) => text(commerce.visible_price).includes(symbol));
  const quote = quoteLed(facts);
  const publicSale = Boolean(entity.has_purchase_control) && !quote;
  const availability = [
    ...new Set([
      ...textList(schema.availability).filter(Boolean),
      ...[text(commerce.visible_availability).trim()].filter(Boolean),
    ]),
  ];
  const identity = list(record(facts.headings).h1_texts).length > 0 || list(schema.name).length > 0;
  const offer = quote || (publicSale && price && currency);
  const variants = Boolean(entity.has_variant_control) || list(schema.variants).length > 0;
  const traits = new Set(textList(facts.page_traits));
  const atoms = [
    atomDetail(contract, 'identity', identity, identity, traits),
    atomDetail(contract, 'offer', offer, offer, traits),
    atomDetail(
      contract,
      'availability',
      quote || availability.length > 0,
      availability.slice(0, 8),
      traits,
    ),
    atomDetail(contract, 'variants', variants, variants, traits),
  ];
  return [
    compositeOutcome(contract, atoms),
    {
      atoms,
      threshold: contract.threshold,
      public_sale: publicSale,
      quote_led: quote,
      transaction_path: publicSale || quote,
      price_observed: price,
      currency_observed: currency,
    },
  ];
}

/** An authored offer expiry checked at the frozen audit time. */
function offerValidity(value: string, auditTime: unknown) {
  const validUntil = /^\d{4}-\d{2}-\d{2}/u.exec(value)?.[0];
  const parsed = validUntil ? new Date(`${validUntil}T00:00:00Z`) : null;
  // A real calendar date only: the parser would roll 2024-02-30 into March.
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== validUntil)
    return 'invalid_expiry';
  const observed = typeof auditTime === 'string' ? Date.parse(auditTime) : Number.NaN;
  if (Number.isNaN(observed)) return 'audit_time_unavailable';
  return validUntil >= new Date(observed).toISOString().slice(0, 10) ? 'current' : 'expired';
}

function offerFreshness(facts: Facts): CheckResult {
  const { entity, schema, commerce } = productSignals(facts);
  const offer =
    Boolean(entity.has_primary_price) ||
    list(schema.price).length > 0 ||
    Boolean(commerce.visible_price);
  const currency = [...new Set(textList(schema.price_currency).filter(Boolean))];
  const validity =
    textList(schema.price_valid_until)
      .map((value) => value.trim())
      .find(Boolean) ?? '';
  const state = validity ? offerValidity(validity, facts.audit_time) : 'not_declared';
  const evidence = {
    offer,
    currency: currency.slice(0, 8),
    timestamp: validity.slice(0, 128),
    timestamp_source: validity ? 'offer_price_valid_until' : '',
    expiry_state: state,
  };
  if (quoteLed(facts)) return ['not_applicable', { ...evidence, reason: 'quote_led_offer' }];
  if (!offer) return ['missing', { ...evidence, reason: 'offer_state_missing' }];
  if (!currency.length) return ['missing', { ...evidence, reason: 'offer_currency_missing' }];
  if (state === 'not_declared')
    return ['not_applicable', { ...evidence, reason: 'expiry_not_declared' }];
  if (state !== 'current')
    return [
      state === 'audit_time_unavailable' ? 'unknown' : 'missing',
      { ...evidence, reason: state },
    ];
  return ['satisfied', evidence];
}

function productEvidence(facts: Facts): CheckResult {
  const { entity, schema } = productSignals(facts);
  const identifiers = [...textList(schema.sku), ...textList(schema.gtin), ...textList(schema.mpn)];
  const marker = Boolean(entity.has_sku_marker);
  return [
    passFail(identifiers.length > 0 || marker),
    { identifiers: identifiers.slice(0, 12), visible_identifier_marker: marker },
  ];
}

function productBrand(facts: Facts): CheckResult {
  const { entity, schema } = productSignals(facts);
  const visible = textList(entity.brand_names).filter(Boolean);
  const brands = [...new Set([...visible, ...textList(schema.brand).filter(Boolean)])];
  return [
    passFail(brands.length > 0),
    { brands: brands.slice(0, 8), visible_brands: visible.slice(0, 8) },
  ];
}

function listingAnswerSet(facts: Facts, contract: CompositeContract): CheckResult {
  const listing = record(record(facts.entity).listing);
  const purpose = list(record(facts.headings).h1_texts).length > 0;
  const items = Math.max(
    count(listing.distinct_card_list_targets),
    list(record(facts.commerce).product_cards).length,
  );
  const empty = Boolean(listing.has_empty_state);
  const traits = new Set(textList(facts.page_traits));
  const atoms = [
    atomDetail(contract, 'collection_purpose', purpose, purpose, traits),
    atomDetail(
      contract,
      'item_set',
      items > 0 || empty,
      { item_count: items, empty_state: empty },
      traits,
    ),
  ];
  return [compositeOutcome(contract, atoms), { atoms, threshold: contract.threshold }];
}

function emptyListingItems(facts: Facts, cards: Facts[], collection: Facts): CheckResult | null {
  if (record(record(facts.entity).listing).has_empty_state !== true) return null;
  const container = record(collection.container);
  if (cards.length || count(container.item_count) > 0 || records(collection.items).length)
    return ['unknown', { reason: 'conflicting_empty_collection', items: [] }];
  if (!text(container.tag) || container.item_count !== 0)
    return ['unknown', { reason: 'empty_collection_unconfirmed', items: [] }];
  return ['not_applicable', { reason: 'explicit_empty_collection', item_fact_count: 0, items: [] }];
}

function listingItemFacts(facts: Facts): CheckResult {
  const cards = records(record(facts.commerce).product_cards);
  const collection = record(record(record(facts.entity).listing).collection_evidence);
  const empty = emptyListingItems(facts, cards, collection);
  if (empty) return empty;
  const complete = [...cards, ...records(collection.items)].flatMap((card) => {
    const title = text(card.title);
    const url = text(card.url);
    return title.trim() && !isGenericItemLabel(title) && url.trim()
      ? [{ title: title.slice(0, 256), url: url.slice(0, 512) }]
      : [];
  });
  if (
    !complete.length &&
    count(record(collection.container).item_count) > 0 &&
    !Array.isArray(collection.items)
  )
    return ['unknown', { reason: 'collection_item_details_unavailable', items: [] }];
  return [
    passFail(complete.length > 0),
    { item_fact_count: complete.length, items: complete.slice(0, 12) },
  ];
}

export function contentChecks(
  composite: (ruleId: string) => CompositeContract,
): Record<string, (facts: Facts) => CheckResult> {
  return {
    'technical.title_present': (facts) => presentField(facts, 'title', 'title_length'),
    'technical.meta_description_present': (facts) =>
      presentField(facts, 'meta_description', 'description_length'),
    'technical.canonical_present': (facts) => presentField(facts, 'canonical_url'),
    'aeo.structured_data_present': structuredDataPresent,
    'aeo.open_graph_present': openGraphPresent,
    'aeo.visible_attribution': visibleAttribution,
    'aeo.content_date_present': contentDatePresent,
    'aeo.content_recency': contentRecency,
    'aeo.entity_profiles': entityProfiles,
    'aeo.source_support_present': sourceSupportPresent,
    'aeo.organization_identity': organizationIdentity,
    'aeo.trust_path_present': trustPath,
    'aeo.answer_first': answerFirst,
    'aeo.question_headings': questionHeadings,
    'aeo.heading_hierarchy': headingHierarchy,
    'aeo.product_answer_facts': (facts) =>
      productAnswerFacts(facts, composite('aeo.product_answer_facts')),
    'aeo.product_evidence_facts': productEvidence,
    'aeo.product_brand_identity': productBrand,
    'aeo.offer_freshness_signal': offerFreshness,
    'aeo.listing_answer_set': (facts) =>
      listingAnswerSet(facts, composite('aeo.listing_answer_set')),
    'aeo.listing_item_facts': listingItemFacts,
  };
}
