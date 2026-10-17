/** Page-kind schema expectations: the page's primary entity, its properties and visible match. */
import { stripTrailing } from '../../text-order.ts';
import { firstOf, onlyOf } from '../../lists.ts';
import { passFail } from './delivery-checks.ts';
import { resolveCanonical, type CheckResult } from './indexing.ts';
import { analysisPolicy } from './policy.ts';
import { list, record, records, text, textList, type Facts } from './read-facts.ts';

const r = analysisPolicy.rules;
type Expectation = (typeof r.expected_schema)[keyof typeof r.expected_schema];
type Block = Record<string, unknown>;
const TOKEN = /[\p{L}\p{N}]+/gu;
const RELATIONSHIPS = new Set(r.schema_relationship_properties);

/** Normalize only legal suffixes; the rest of the declared company identity must still match. */
function companyName(value: string) {
  const tokens = value.toLowerCase().match(TOKEN) ?? [];
  for (const suffix of analysisPolicy.facts.company_legal_name_suffixes) {
    const ending = suffix.match(TOKEN) ?? [];
    if (
      tokens.length > ending.length &&
      ending.every((token, index) => tokens[tokens.length - ending.length + index] === token)
    )
      return tokens.slice(0, -ending.length).join(' ');
  }
  return value;
}

function expectationFor(facts: Facts): Expectation {
  const kind = text(facts.page_kind).trim().toLowerCase();
  if (kind === r.product_schema_expectation.page_kind) return r.product_schema_expectation;
  const expected: Record<string, Expectation> = r.expected_schema;
  return expected[kind] ?? r.expected_schema.other;
}
function propertiesFor(expectation: Expectation, type: string, recommended: boolean): string[] {
  const overrides: Record<string, string[]> = recommended
    ? expectation.recommended_by_type
    : expectation.required_by_type;
  return overrides[type] ?? (recommended ? expectation.recommended : expectation.required);
}
const missingPaths = (block: Block, paths: string[]) => {
  const present = new Set(textList(block.props_present));
  return paths.filter((path) => !present.has(path));
};

const tokenSet = (value: string) => new Set(value.toLowerCase().match(TOKEN) ?? []);

/**
 * The share of a schema name's words the visible text shows. A long SEO title
 * holding a short, correct name still names it, so the title's own length is
 * not held against it.
 */
function claimCoverage(claim: Set<string>, visible: Set<string>) {
  if (!claim.size) return 0;
  return [...claim].filter((token) => visible.has(token)).length / claim.size;
}

/** A document URL for comparison: http(s), lower-cased host, trailing slash trimmed, no fragment. */
function documentUrl(value: unknown) {
  const raw = text(value).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return '';
  const path = url.pathname === '/' ? '/' : stripTrailing(url.pathname, '/');
  return `${url.protocol}//${url.host}${path}${url.search}`;
}
function documentUrls(facts: Facts) {
  const finalUrl = text(record(facts.delivery).final_url);
  const canonical = resolveCanonical(text(facts.canonical_url), finalUrl);
  return new Set([finalUrl, canonical].map(documentUrl).filter(Boolean));
}

/** What identifies the entity a block describes: its `@id`, else its JSON-LD object. */
function entityKey(block: Block) {
  const id = text(block.schema_id).trim();
  if (id) return `id:${id}`;
  return typeof block.entity_index === 'number' ? `object:${block.entity_index}` : null;
}
const satisfiesRequired = (block: Block, expectation: Expectation) =>
  !missingPaths(block, propertiesFor(expectation, text(block.type), false)).length;

/**
 * Expected-type blocks, at most one per entity; a satisfied contract wins within
 * an entity. An object nested as another's publisher, author or parent
 * organization describes that relationship, not the page.
 */
function expectedBlocks(blocks: Block[], expectation: Expectation) {
  const expected = new Set(expectation.expected_types);
  const grouped = new Map<string, Block>();
  const anonymous: Block[] = [];
  for (const block of blocks) {
    if (!expected.has(text(block.type))) continue;
    if (RELATIONSHIPS.has(text(block.parent_property))) continue;
    const key = entityKey(block);
    if (key === null) anonymous.push(block);
    else {
      const incumbent = grouped.get(key);
      if (
        !incumbent ||
        (!satisfiesRequired(incumbent, expectation) && satisfiesRequired(block, expectation))
      )
        grouped.set(key, block);
    }
  }
  return [...grouped.values(), ...anonymous];
}

function bindings(blocks: Block[], candidates: Block[], urls: Set<string>) {
  const pageIds = new Set<string>();
  const declaredPrimary = new Set<string>();
  for (const block of blocks) {
    if (!urls.has(documentUrl(block.url))) continue;
    if (text(block.schema_id)) pageIds.add(text(block.schema_id));
    if (text(block.main_entity_id)) declaredPrimary.add(text(block.main_entity_id));
  }
  const declared = new Set<number>();
  const byUrl = new Set<number>();
  candidates.forEach((block, index) => {
    const reference = text(block.main_entity_of_page_id);
    if (
      declaredPrimary.has(text(block.schema_id)) ||
      pageIds.has(reference) ||
      urls.has(documentUrl(reference))
    )
      declared.add(index);
    if (urls.has(documentUrl(block.url))) byUrl.add(index);
  });
  return { declared, byUrl };
}

type Selection = { outcome: string; blocks: Block[]; evidence: Record<string, unknown> };

/**
 * Bound candidates of distinct types name one entity each, so the earliest
 * expected type is the page's primary (a homepage's Organization over its
 * WebSite); two bound candidates of one type stay ambiguous.
 */
function byExpectedOrder(candidates: Block[], selected: Set<number>, expectedTypes: string[]) {
  const typeOf = (index: number) => text(candidates[index]?.type);
  const types = [...selected].map(typeOf);
  if (selected.size < 2 || new Set(types).size !== types.length) return selected;
  const rank = (index: number) => expectedTypes.indexOf(typeOf(index));
  const [head, ...rest] = [...selected];
  if (head === undefined) return selected;
  const first = rest.reduce((best, index) => (rank(index) < rank(best) ? index : best), head);
  return new Set([first]);
}

function resolveSelection(
  candidates: Block[],
  evidence: Record<string, unknown>,
  bound: { declared: Set<number>; byUrl: Set<number> },
  expectedTypes: string[],
): Selection {
  const { declared, byUrl } = bound;
  let selected = declared.size ? declared : byUrl;
  if (declared.size && byUrl.size) {
    const corroborated = new Set([...declared].filter((index) => byUrl.has(index)));
    if (!corroborated.size)
      return {
        outcome: 'unknown',
        blocks: [],
        evidence: {
          ...evidence,
          reason: 'conflicting_schema_entities',
          declared_candidate_indexes: [...declared].sort((a, b) => a - b),
          url_candidate_indexes: [...byUrl].sort((a, b) => a - b),
        },
      };
    selected = corroborated;
  }
  selected = byExpectedOrder(candidates, selected, expectedTypes);
  const index = onlyOf(selected);
  const chosen = index === undefined ? undefined : candidates[index];
  if (chosen) return { outcome: 'satisfied', blocks: [chosen], evidence };
  if (selected.size > 1 || candidates.length > 1)
    return {
      outcome: 'unknown',
      blocks: [],
      evidence: { ...evidence, reason: 'ambiguous_primary_schema_entity' },
    };
  const only = firstOf(candidates, 'the one expected-type schema candidate');
  if (documentUrl(only.url))
    return {
      outcome: 'missing',
      blocks: [],
      evidence: { ...evidence, reason: 'expected_schema_other_document' },
    };
  return { outcome: 'satisfied', blocks: candidates, evidence };
}

/** The one expected-type entity this page is about, or why there is none. */
function primarySelection(facts: Facts, expectation: Expectation): Selection {
  const all = records(record(facts.structured_data).blocks);
  const candidates = expectedBlocks(all, expectation);
  const evidence: Record<string, unknown> = {
    page_kind: expectation.page_kind,
    expected_types: expectation.expected_types,
    candidate_count: candidates.length,
  };
  if (!candidates.length)
    return {
      outcome: 'missing',
      blocks: [],
      evidence: { ...evidence, reason: 'expected_schema_absent' },
    };
  const bound = bindings(all, candidates, documentUrls(facts));
  return resolveSelection(candidates, evidence, bound, expectation.expected_types);
}

function propertyCheck(facts: Facts, recommended: boolean): CheckResult {
  const label = recommended ? 'recommended' : 'required';
  const expectation = expectationFor(facts);
  const selection = primarySelection(facts, expectation);
  if (selection.outcome === 'unknown') return ['unknown', selection.evidence];
  if (selection.outcome !== 'satisfied')
    return ['not_applicable', { ...selection.evidence, reason: 'no_expected_type_block' }];
  const candidates = selection.blocks.flatMap((block) => {
    const paths = propertiesFor(expectation, text(block.type), recommended);
    return paths.length ? [{ block, paths, missing: missingPaths(block, paths) }] : [];
  });
  const first = candidates[0];
  if (!first) return ['not_applicable', { reason: `no_${label}_properties` }];
  const evidence: Record<string, unknown> = {
    page_kind: expectation.page_kind,
    schema_type: text(first.block.type),
    expected_types: expectation.expected_types,
    [label]: first.paths,
    missing: first.missing,
    checked_blocks: candidates.length,
  };
  const shallowMicrodata = candidates.some(
    ({ block }) => block.syntax === 'microdata' && !list(block.props_present).length,
  );
  if (first.missing.length && shallowMicrodata) evidence.extraction = 'microdata_shallow';
  return [passFail(!first.missing.length), evidence];
}

function schemaMatchesContent(facts: Facts): CheckResult {
  const expectation = expectationFor(facts);
  const selection = primarySelection(facts, expectation);
  if (selection.outcome === 'unknown') return ['unknown', selection.evidence];
  if (selection.outcome !== 'satisfied')
    return ['not_applicable', { ...selection.evidence, reason: 'no_expected_type_block' }];
  const named = selection.blocks
    .map((block) => ({ name: text(block.name).trim(), type: text(block.type) }))
    .filter((block) => block.name)
    .slice(0, r.schema_content_match_max_candidates);
  if (!named.length) return ['not_applicable', { reason: 'no_schema_names' }];
  const visible = [text(facts.title), ...textList(record(facts.headings).h1_texts)].map(tokenSet);
  // Markup conflicts when it names something the page does not show; a name
  // the title/h1 phrase differently but the page visibly carries is consistent.
  const bodyFacts = record(facts.body);
  const body = tokenSet(text(bodyFacts.text));
  const matched = named.some(({ name, type }) => {
    const claim = tokenSet(type === 'Organization' ? companyName(name) : name);
    return (
      visible.some(
        (value) => claimCoverage(claim, value) >= r.schema_content_match_min_token_overlap,
      ) || claimCoverage(claim, body) === 1
    );
  });
  const evidence = {
    page_kind: expectation.page_kind,
    candidates: named.map(({ name }) => name.slice(0, 256)),
    matched_visible_content: matched,
  };
  // Text past the stored cap was never read, so a missing name is unproven there.
  if (!matched && bodyFacts.truncated === true)
    return ['unknown', { ...evidence, reason: 'body_text_truncated' }];
  return [passFail(matched), evidence];
}

export const SCHEMA_CHECKS: Record<string, (facts: Facts) => CheckResult> = {
  'aeo.schema_required_valid': (facts) => propertyCheck(facts, false),
  'aeo.schema_recommended_present': (facts) => propertyCheck(facts, true),
  'aeo.schema_matches_content': schemaMatchesContent,
};
