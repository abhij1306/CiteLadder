import { analysisPolicy, limits, words } from './policy.ts';
import { passFail } from './delivery-checks.ts';
import { count, list, record, text, type Facts } from './read-facts.ts';
import { comparableUrl, resolveCanonical, type CheckResult } from './indexing.ts';

const thresholds = analysisPolicy.rules.on_page_thresholds;

function structuredDataValid(facts: Facts): CheckResult {
  const recorded = record(facts.structured_data).invalid_json_ld_count;
  if (typeof recorded !== 'number') return ['unknown', { reason: 'insufficient_evidence' }];
  const invalid = count(recorded);
  return [passFail(invalid === 0), { invalid_json_ld_count: invalid }];
}

function h1Present(facts: Facts): CheckResult {
  const h1 = count(record(facts.headings).h1_count);
  return [passFail(h1 > 0), { h1_count: h1 }];
}

function singleH1(facts: Facts): CheckResult {
  const h1 = count(record(facts.headings).h1_count);
  if (h1 === 0) return ['not_applicable', { reason: 'no_h1', h1_count: h1 }];
  return [passFail(h1 === 1), { h1_count: h1 }];
}

const OPEN_GRAPH_REQUIRED = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];

function openGraphPresent(facts: Facts): CheckResult {
  const og = record(facts.open_graph);
  const missing = OPEN_GRAPH_REQUIRED.filter((key) => !text(og[key]).trim());
  return [
    passFail(missing.length === 0),
    { missing_properties: missing, property_count: Object.keys(og).length },
  ];
}

function twitterCardPresent(facts: Facts): CheckResult {
  const card = text(record(facts.twitter)['twitter:card']).trim();
  return [passFail(Boolean(card)), { twitter_card: card }];
}

function openGraphUrlMatches(facts: Facts): CheckResult {
  const finalUrl = text(record(facts.delivery).final_url);
  const ogUrl = resolveCanonical(text(record(facts.open_graph)['og:url']), finalUrl);
  if (!ogUrl) return ['not_applicable', { reason: 'no_open_graph_url' }];
  const canonical = resolveCanonical(text(facts.canonical_url), finalUrl);
  const evidence = {
    open_graph_url: ogUrl.slice(0, 2048),
    canonical_url: canonical.slice(0, 2048),
  };
  if (!canonical) return ['not_applicable', { ...evidence, reason: 'no_canonical' }];
  return comparableUrl(ogUrl) === comparableUrl(canonical)
    ? ['satisfied', evidence]
    : ['missing', { ...evidence, reason: 'open_graph_url_differs' }];
}

const lengthInRange =
  (field: 'title' | 'meta_description', range: { min_chars: number; max_chars: number }) =>
  (facts: Facts): CheckResult => {
    const value = text(facts[field]).replaceAll(/\s+/gu, ' ').trim();
    if (!value) return ['not_applicable', { reason: `empty_${field}` }];
    const length = [...value].length;
    const evidence = {
      length,
      min_chars: range.min_chars,
      max_chars: range.max_chars,
      [field]: value,
    };
    if (length < range.min_chars) return ['missing', { ...evidence, reason: 'too_short' }];
    if (length > range.max_chars) return ['missing', { ...evidence, reason: 'too_long' }];
    return ['satisfied', evidence];
  };

function thinContent(facts: Facts): CheckResult {
  const minimum = thresholds.thin_content_min_words;
  if (facts.primary_content_truncated === true)
    return ['satisfied', { minimum_words: minimum, truncated: true }];
  const found = words(text(facts.primary_content_text)).length;
  return [passFail(found >= minimum), { word_count: found, minimum_words: minimum }];
}

function longParagraphs(facts: Facts): CheckResult {
  if (!Array.isArray(facts.primary_paragraph_word_counts))
    return ['unknown', { reason: 'insufficient_evidence' }];
  const maximum = thresholds.long_paragraph_max_words;
  const counts = list(facts.primary_paragraph_word_counts).map(count);
  const long = counts.filter((value) => value > maximum);
  if (!long.length && counts.length >= limits.paragraphs_kept)
    return ['unknown', { reason: 'paragraphs_truncated', paragraph_count: counts.length }];
  return [
    passFail(long.length === 0),
    {
      paragraph_count: counts.length,
      long_paragraph_count: long.length,
      longest_paragraph_words: Math.max(0, ...counts),
      maximum_words: maximum,
    },
  ];
}

function httpRedirectsToHttps(facts: Facts): CheckResult {
  if (!text(record(facts.delivery).final_url).startsWith('https://'))
    return ['not_applicable', { reason: 'root_not_https' }];
  const probe = record(record(facts.site).http_origin);
  const evidence = { ...probe };
  switch (text(probe.state)) {
    case 'not_probed':
      return ['unknown', { ...evidence, reason: text(probe.reason) || 'no_http_origin' }];
    case 'unanswered':
      return ['satisfied', evidence];
    case 'answered': {
      if (text(probe.final_url).startsWith('https://')) return ['satisfied', evidence];
      const status = count(probe.final_status_code);
      if (status >= 200 && status < 300)
        return ['missing', { ...evidence, reason: 'http_served_without_redirect' }];
      return ['unknown', { ...evidence, reason: 'http_origin_error_status' }];
    }
    case 'failed':
      return ['unknown', { ...evidence, reason: 'http_origin_unread' }];
    default:
      return ['unknown', { reason: 'insufficient_evidence' }];
  }
}

export const ON_PAGE_CHECKS: Record<string, (facts: Facts) => CheckResult> = {
  'aeo.structured_data_valid': structuredDataValid,
  'technical.h1_present': h1Present,
  'technical.single_h1': singleH1,
  'aeo.open_graph_present': openGraphPresent,
  'aeo.open_graph_url_matches': openGraphUrlMatches,
  'aeo.twitter_card_present': twitterCardPresent,
  'technical.http_redirects_to_https': httpRedirectsToHttps,
  'technical.title_length': lengthInRange('title', thresholds.title_length),
  'technical.meta_description_length': lengthInRange(
    'meta_description',
    thresholds.meta_description_length,
  ),
  'aeo.thin_content': thinContent,
  'aeo.long_paragraphs': longParagraphs,
};
