/**
 * Additive page traits: what else a page carries, independent of its kind. A
 * product page with an FAQ stays a product and gains `has_faq`. Each trait is
 * an observation the page's own evidence supports, never a guess.
 */
import { analysisPolicy } from './policy.ts';
import { observedQuestionCount } from './questions.ts';
import { count, list, record, text, textList, type Facts } from './read-facts.ts';

const t = analysisPolicy.traits;
const ROUTE_SEGMENTS: Record<string, string[]> = t.route_segments;
const TITLE_PHRASES: Record<string, string[]> = t.title_phrases;
const SCHEMA_TYPES: Record<string, string[]> = t.schema_types;
const CONTACT_FIELDS = new Set(t.contact_form_fields);
const VARIANT_FIELDS = new Set(t.variant_form_fields);
const escapePattern = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

function pathSegments(finalUrl: string) {
  try {
    return new Set(new URL(finalUrl).pathname.toLowerCase().split('/').filter(Boolean));
  } catch {
    return new Set<string>();
  }
}
const haystack = (facts: Facts) =>
  ` ${[text(facts.title), ...textList(record(facts.headings).h1_texts).slice(0, 1)].join(' ').toLowerCase()} `;
const schemaTypes = (facts: Facts) => new Set(textList(record(facts.structured_data).types));
const hasSchema = (facts: Facts, trait: string) =>
  (SCHEMA_TYPES[trait] ?? []).some((type) => schemaTypes(facts).has(type));

/** A route segment, else a bounded title/H1 phrase. */
function intent(trait: string, finalUrl: string, facts: Facts) {
  const segments = pathSegments(finalUrl);
  if ((ROUTE_SEGMENTS[trait] ?? []).some((segment) => segments.has(segment))) return true;
  const title = haystack(facts);
  return (TITLE_PHRASES[trait] ?? []).some((phrase) => title.includes(` ${phrase} `));
}

function companyProfileIntent(finalUrl: string, facts: Facts) {
  const segments = pathSegments(finalUrl);
  const title = haystack(facts);
  const normalized = [...segments, title].join(' ').replaceAll('-', ' ');
  const excluded = t.company_profile.excluded_terms.some((term) =>
    new RegExp(String.raw`(?<![\p{L}\p{N}_])${escapePattern(term)}(?![\p{L}\p{N}_])`, 'u').test(
      normalized,
    ),
  );
  if (excluded) return false;
  return (
    t.company_profile.route_segments.some((segment) => segments.has(segment)) ||
    t.company_profile.title_phrases.some((phrase) => title.includes(` ${phrase} `))
  );
}

const fieldTokens = (facts: Facts) =>
  textList(facts.form_fields).flatMap((field) => field.toLowerCase().match(/[a-z0-9]+/gu) ?? []);
const hasContactFormFields = (facts: Facts) =>
  textList(facts.form_fields)
    .flatMap((field) => field.trim().toLowerCase().split(/\s+/u))
    .some((token) => CONTACT_FIELDS.has(token));

function observed(finalUrl: string, facts: Facts): Record<string, boolean> {
  const entity = record(facts.entity);
  const location = record(entity.location);
  const listing = record(record(record(entity.listing).collection_evidence).container);
  return {
    has_faq:
      hasSchema(facts, 'has_faq') ||
      observedQuestionCount(facts.question_answer_relationships) >=
        analysisPolicy.classification.faq_min_headings,
    has_reviews:
      hasSchema(facts, 'has_reviews') ||
      list(record(record(facts.structured_data).product).ratings).length > 0,
    has_variants: fieldTokens(facts).some((token) => VARIANT_FIELDS.has(token)),
    listing: count(listing.item_count) >= analysisPolicy.entity.listing_min_card_items,
    local_intent:
      count(location.address_entity_count) >= 1 &&
      Boolean(location.has_phone || location.has_hours),
    contact_intent:
      list(facts.contact_points).length > 0 ||
      hasContactFormFields(facts) ||
      intent('contact_intent', finalUrl, facts),
    about_intent: intent('about_intent', finalUrl, facts),
    company_profile_intent: companyProfileIntent(finalUrl, facts),
    case_study_intent: intent('case_study_intent', finalUrl, facts),
    comparison_content: intent('comparison_content', finalUrl, facts),
    procedural:
      hasSchema(facts, 'procedural') || count(facts.ordered_list_steps) >= t.procedural_min_steps,
  };
}

/** Observed traits in stable config order. */
export function deriveTraits(finalUrl: string, facts: Facts): string[] {
  const found = observed(finalUrl, facts);
  return t.order.filter((trait) => found[trait]);
}
