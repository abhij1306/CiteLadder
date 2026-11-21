import {
  originOf,
  records,
  sitePath,
  text,
  textList,
  withoutQuery,
  type Evidence,
} from './evidence-values';
import { pageListRules, siteLevelFacts, siteLevelRules } from './site-level-evidence';

const MAX_FACTS = 8;
const MAX_FACT_CHARS = 140;

function absent(evidence: Evidence, notations: Readonly<Record<string, string>>): string[] {
  return Object.entries(notations)
    .filter(([key]) => {
      const value = evidence[key];
      return Array.isArray(value) ? value.length === 0 : !value;
    })
    .map(([, notation]) => notation);
}

const lengthRange = (evidence: Evidence) => [
  `${String(evidence.length)} characters (recommended ${String(evidence.min_chars)}–${String(evidence.max_chars)})`,
];

function tally(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => (count > 1 ? `${value} ×${count}` : value));
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').trim();
}

function headingSkips(evidence: Evidence): string[] {
  return tally(
    records(evidence.skips)
      .filter((skip) => typeof skip.from === 'number' && typeof skip.to === 'number')
      .map((skip) => `h${String(skip.from)} → h${String(skip.to)}`),
  );
}

function cssAttribute(value: string): string {
  return value.replace(
    /["\\\n\r\f]/gu,
    (character) => `\\${character.codePointAt(0)!.toString(16)} `,
  );
}

function controlSelector(control: Evidence): string {
  const tag = text(control.tag).toLowerCase();
  if (!tag) return '';
  const id = text(control.id);
  if (id) return `${tag}[id="${cssAttribute(id)}"]`;
  const name = text(control.name);
  if (name) return `${tag}[name="${cssAttribute(name)}"]`;
  const type = text(control.type).toLowerCase();
  return type && type !== tag ? `${tag}[type="${cssAttribute(type)}"]` : tag;
}

function formControls(evidence: Evidence): string[] {
  return tally(
    records(evidence.missing_control_descriptors)
      .map(controlSelector)
      .filter((selector) => selector.length > 0),
  );
}

function schemaProperties(evidence: Evidence): string[] {
  const type = text(evidence.schema_type) || textList(evidence.expected_types)[0] || 'Schema';
  return textList(evidence.missing).map((path) => `${type}.${path}`);
}

function schemaTypeMismatch(evidence: Evidence): string[] {
  const expected = textList(evidence.expected_types);
  if (expected.length === 0) return [];
  const found = textList(evidence.found_types);
  return found.length > 0
    ? [`${expected.join(' or ')} expected, ${found.join(', ')} found`]
    : expected;
}

function unmetAtoms(evidence: Evidence): string[] {
  return records(evidence.atoms)
    .filter((atom) => atom.outcome === 'missing' || atom.outcome === 'partial')
    .map((atom) => humanize(text(atom.name)))
    .filter((name) => name.length > 0);
}

function failingLinkTargets(evidence: Evidence): string[] {
  return records(evidence.failing_targets)
    .filter((target) => text(target.url).length > 0)
    .map((target) =>
      typeof target.status_code === 'number'
        ? `${text(target.url)} → ${String(target.status_code)}`
        : text(target.url),
    );
}

function pageLinks(
  evidence: Evidence,
  outcome: (target: Evidence, origin: string | null) => string,
): string[] {
  const groups = new Map<string, { fact: string; variants: number }>();
  for (const target of records(evidence.failing_targets)) {
    const url = text(target.url);
    if (!url) continue;
    const origin = originOf(url);
    const link = sitePath(withoutQuery(url), origin);
    const fact = `${link} → ${outcome(target, origin)}`;
    const group = groups.get(fact);
    if (group) group.variants += 1;
    else groups.set(fact, { fact, variants: 0 });
  }
  return [...groups.values()].map(({ fact, variants }) => {
    if (variants === 0) return fact;
    const noun = variants === 1 ? 'variant' : 'variants';
    return `${fact} (+${String(variants)} ${noun})`;
  });
}

function linkRedirects(evidence: Evidence, pageUrl: string | null): string[] {
  const page = pageUrl ? withoutQuery(pageUrl) : null;
  return pageLinks(evidence, (target, origin) => {
    if (target.reason === 'redirect_limit') return 'redirect loop';
    const final = withoutQuery(text(target.final_url));
    const hops =
      typeof target.hops === 'number' && target.hops > 1 ? ` (${String(target.hops)} hops)` : '';
    const landing = page !== null && final === page ? 'this page' : sitePath(final, origin);
    return `${landing}${hops}`;
  });
}

function brokenLinks(evidence: Evidence): string[] {
  return pageLinks(evidence, (target) =>
    typeof target.status_code === 'number' ? String(target.status_code) : 'unreachable',
  );
}

function redirectTargets(evidence: Evidence): string[] {
  return records(evidence.failing_targets)
    .filter((target) => text(target.url).length > 0)
    .map((target) => {
      if (target.reason === 'redirect_limit') return `${text(target.url)} → redirect loop`;
      const hops =
        typeof target.hops === 'number' && target.hops > 1 ? ` (${String(target.hops)} hops)` : '';
      return `${text(target.url)} → ${text(target.final_url)}${hops}`;
    });
}

function canonicalTarget(evidence: Evidence): string[] {
  const target = text(evidence.target_url) || textList(evidence.declarations)[0] || '';
  switch (evidence.reason) {
    case 'canonical_target_redirects':
      return [`${target} → redirects`];
    case 'canonical_target_noindex':
      return [`${target} → noindex`];
    case 'canonical_chain':
      return [`${target} → canonical ${text(evidence.target_canonical_url)}`];
    case 'canonical_target_error':
      return [`${target} → ${String(evidence.status_code)}`];
    default: {
      const declarations = textList(evidence.declarations);
      return declarations.length ? declarations : reasonPhrase(evidence);
    }
  }
}

function duplicatePages(evidence: Evidence): string[] {
  return records(evidence.duplicates)
    .filter((duplicate) => text(duplicate.url).length > 0)
    .map((duplicate) => `${text(duplicate.url)} (${text(duplicate.match)})`);
}

function sitemapLastmod(evidence: Evidence): string[] {
  const lastmod = `lastmod ${text(evidence.sitemap_lastmod)}`;
  if (evidence.reason === 'sitemap_lastmod_stale') {
    const dates = textList(evidence.page_dates);
    return dates.length ? [lastmod, `page dated ${dates.join(', ')}`] : [lastmod];
  }
  return evidence.reason === 'sitemap_lastmod_in_future' ? [`${lastmod} (future)`] : [lastmod];
}

function clientRedirect(evidence: Evidence): string[] {
  return evidence.reason === 'meta_refresh_redirect'
    ? [`<meta http-equiv="refresh"> → ${text(evidence.target_url)}`]
    : ['location redirect in script'];
}

function ttfbBand(evidence: Evidence): string[] {
  const { ttfb_ms: measured, threshold_ms: budget } = evidence;
  if (typeof measured !== 'number') return [];
  return typeof budget === 'number'
    ? [`${String(Math.round(measured))} ms · budget ${String(budget)} ms`]
    : [`${String(Math.round(measured))} ms`];
}

function missingAlt(evidence: Evidence): string[] {
  const missing = evidence.missing_alt;
  if (typeof missing !== 'number' || missing === 0) return [];
  return [`alt ×${String(missing)}`];
}

function offerFreshness(evidence: Evidence): string[] {
  if (evidence.offer === false || evidence.reason === 'offer_not_structured') return ['Offer'];
  if (evidence.reason === 'offer_currency_missing') return ['priceCurrency'];
  const timestamp = text(evidence.timestamp);
  return timestamp
    ? [`priceValidUntil ${timestamp} (${humanize(text(evidence.expiry_state))})`]
    : reasonPhrase(evidence);
}

function indexable(evidence: Evidence): string[] {
  if (evidence.noindex !== true) return reasonPhrase(evidence);
  const directives = evidence.nofollow === true ? 'noindex, nofollow' : 'noindex';
  const intent: Readonly<Record<string, string>> = {
    sitemap_membership: 'listed in sitemap.xml',
    explicit_user_policy: 'marked for indexing in project settings',
  };
  const why = intent[text(evidence.intent_source)];
  return why ? [directives, why] : [directives];
}

const FACTS_BY_RULE: Readonly<
  Record<string, (evidence: Evidence, pageUrl: string | null) => string[]>
> = {
  'technical.title_present': () => ['<title>'],
  'technical.meta_description_present': () => ['<meta name="description">'],
  'technical.canonical_present': () => ['<link rel="canonical">'],
  'technical.https': (evidence) => [text(evidence.scheme) || 'http'],
  'technical.hsts_present': () => ['Strict-Transport-Security'],
  'technical.uncompressed_html': () => ['Content-Encoding'],
  'technical.ttfb_band': ttfbBand,
  'technical.ai_crawler_access': (evidence) => textList(evidence.blocked),
  'technical.robots_txt_present': () => ['/robots.txt'],
  'search.crawler_access': (evidence) => textList(evidence.blocked),
  'search.snippet_access': (evidence) => textList(evidence.directives),
  'aeo.structured_data_present': (evidence) =>
    absent(evidence, { has_json_ld: 'JSON-LD', has_microdata: 'Microdata' }),
  'aeo.open_graph_present': (evidence) =>
    absent(evidence, { has_og_title: 'og:title', has_og_description: 'og:description' }),
  'aeo.schema_required_valid': schemaProperties,
  'aeo.schema_recommended_present': schemaProperties,
  'aeo.schema_matches_content': schemaTypeMismatch,
  'aeo.organization_identity': (evidence) =>
    evidence.has_organization
      ? ['Organization identity incomplete (name and URL required)']
      : ['Organization'],
  'aeo.trust_path_present': () => ['about', 'contact', 'privacy', 'terms'],
  'aeo.content_date_present': (evidence) =>
    absent(evidence, { has_published: 'datePublished', has_modified: 'dateModified' }),
  'aeo.content_recency': (evidence) =>
    typeof evidence.age_days === 'number'
      ? [`dateModified ${evidence.age_days} days old`]
      : reasonPhrase(evidence),
  'aeo.entity_profiles': () => ['sameAs'],
  'technical.sitemap_canonical': (evidence) => [`canonical ${text(evidence.canonical_url)}`],
  'technical.sitemap_redirect': (evidence) => [
    `${text(evidence.listed_url)} → ${text(evidence.final_url)}`,
  ],
  'technical.sitemap_lastmod': sitemapLastmod,
  'technical.client_side_redirect': clientRedirect,
  'technical.canonical_integrity': canonicalTarget,
  'technical.internal_link_redirect': linkRedirects,
  'technical.indexable': indexable,
  'technical.redirect_chain': redirectTargets,
  'technical.duplicate_content': duplicatePages,
  'aeo.visible_attribution': (evidence) =>
    text(evidence.declared_name) ? ['visible author'] : ['author'],
  'aeo.source_support_present': () => ['citation'],
  'aeo.llms_txt_present': () => ['/llms.txt'],
  'technical.sitemap_present': () => ['XML sitemap'],
  'technical.sitemap_valid': (evidence) =>
    records(evidence.invalid_documents).map((row) => withoutQuery(text(row.url))),
  'aeo.structured_data_valid': (evidence) => [
    `${String(evidence.invalid_json_ld_count)} unparseable JSON-LD script(s)`,
  ],
  'technical.h1_present': () => ['<h1>'],
  'technical.http_redirects_to_https': (evidence) => [
    `${text(evidence.final_url)} answers ${String(evidence.final_status_code)} without redirecting to HTTPS`,
  ],
  'technical.title_length': lengthRange,
  'technical.meta_description_length': lengthRange,
  'aeo.thin_content': (evidence) => [
    `${String(evidence.word_count)} words (recommended ${String(evidence.minimum_words)}+)`,
  ],
  'aeo.long_paragraphs': (evidence) => [
    `${String(evidence.long_paragraph_count)} paragraph(s) over ${String(evidence.maximum_words)} words, longest ${String(evidence.longest_paragraph_words)}`,
  ],
  'aeo.product_brand_identity': () => ['brand'],
  'aeo.product_evidence_facts': () => ['gtin', 'mpn', 'sku'],
  'aeo.offer_freshness_signal': offerFreshness,
  'aeo.product_answer_facts': unmetAtoms,
  'aeo.listing_answer_set': unmetAtoms,
  'aeo.listing_item_facts': () => ['No listing item with both title and URL'],
  'aeo.heading_hierarchy': (evidence) =>
    Array.isArray(evidence.skips) ? headingSkips(evidence) : reasonPhrase(evidence),
  'aeo.server_rendered_content': () => ['server-rendered body'],
  'web.accessibility_heading_order': headingSkips,
  'web.accessibility_form_names': formControls,
  'web.accessibility_image_alt': missingAlt,
  'web.accessibility_document_language': () => ['<html lang>'],
  'web.mobile_viewport': () => ['<meta name="viewport">'],
  'web.security_mixed_content': (evidence) => textList(evidence.assets),
  'technical.broken_internal_link': brokenLinks,
  'technical.sitemap_url_unreachable': failingLinkTargets,
  ...Object.fromEntries(
    siteLevelRules.map((rule) => [rule, (evidence: Evidence) => siteLevelFacts(rule, evidence)]),
  ),
};

const LEAD_BY_RULE: Readonly<Record<string, string>> = {
  'technical.internal_link_redirect': 'Links on this page that redirect:',
  'technical.broken_internal_link': 'Broken links on this page:',
  ...Object.fromEntries(pageListRules.map((rule) => [rule, 'Affected pages:'])),
  'architecture.unreachable_from_home': 'Unreachable sections:',
  'technical.sitewide_broken_link': 'Broken links shared by most pages:',
  'technical.sitewide_link_redirect': 'Links shared by most pages that redirect:',
  'architecture.duplicate_titles': 'Titles repeated across pages:',
  'architecture.duplicate_meta_descriptions': 'Meta descriptions repeated across pages:',
  'architecture.unhubbed_page_kind': 'Affected pages:',
};

export function evidenceLead(ruleId: string): string | null {
  return LEAD_BY_RULE[ruleId] ?? null;
}

function reasonPhrase(evidence: Evidence): string[] {
  const reason = text(evidence.reason);
  return reason ? [humanize(reason)] : [];
}

const INTERNAL_KEYS = new Set(['reason', 'reason_code', 'threshold', 'scope', 'page_kind']);

function isIdentifierKey(key: string): boolean {
  return key === 'id' || key.endsWith('_id') || key.endsWith('_ids');
}

function scalarFact(key: string, value: unknown): string[] {
  if (INTERNAL_KEYS.has(key) || isIdentifierKey(key)) return [];
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [`${humanize(key)} ${String(value)}`];
  }
  const list = textList(value);
  if (list.length > 0) return [`${humanize(key)} ${list.slice(0, 5).join(', ')}`];
  const single = text(value);
  return single ? [`${humanize(key)} ${single}`] : [];
}

function scalarFacts(evidence: Evidence): string[] {
  return Object.entries(evidence).flatMap(([key, value]) => scalarFact(key, value));
}

export function evidenceFacts(
  ruleId: string,
  evidence: Evidence,
  context: Readonly<{ pageUrl?: string }> = {},
): string[] {
  const formatter = FACTS_BY_RULE[ruleId];
  const facts = formatter ? formatter(evidence, context.pageUrl ?? null) : [];
  const resolved = facts.length > 0 ? facts : [...reasonPhrase(evidence), ...scalarFacts(evidence)];
  return resolved.slice(0, MAX_FACTS).map((fact) => fact.slice(0, MAX_FACT_CHARS));
}
