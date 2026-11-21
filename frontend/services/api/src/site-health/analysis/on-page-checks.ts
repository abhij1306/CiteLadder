import { analysisPolicy, limits, words } from './policy.ts';
import { passFail } from './delivery-checks.ts';
import { count, list, record, text, type Facts } from './read-facts.ts';
import type { CheckResult } from './indexing.ts';

const advisories = analysisPolicy.rules.on_page_advisories;

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

const lengthInRange =
  (field: 'title' | 'meta_description', range: { min_chars: number; max_chars: number }) =>
  (facts: Facts): CheckResult => {
    const value = text(facts[field]).replaceAll(/\s+/gu, ' ').trim();
    if (!value) return ['not_applicable', { reason: `empty_${field}` }];
    const length = [...value].length;
    const evidence = { length, min_chars: range.min_chars, max_chars: range.max_chars };
    if (length < range.min_chars) return ['missing', { ...evidence, reason: 'too_short' }];
    if (length > range.max_chars) return ['missing', { ...evidence, reason: 'too_long' }];
    return ['satisfied', evidence];
  };

function thinContent(facts: Facts): CheckResult {
  const minimum = advisories.thin_content_min_words;
  if (facts.primary_content_truncated === true)
    return ['satisfied', { minimum_words: minimum, truncated: true }];
  const found = words(text(facts.primary_content_text)).length;
  return [passFail(found >= minimum), { word_count: found, minimum_words: minimum }];
}

function longParagraphs(facts: Facts): CheckResult {
  if (!Array.isArray(facts.primary_paragraph_word_counts))
    return ['unknown', { reason: 'insufficient_evidence' }];
  const maximum = advisories.long_paragraph_max_words;
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
  'technical.http_redirects_to_https': httpRedirectsToHttps,
  'technical.title_length': lengthInRange('title', advisories.title_length),
  'technical.meta_description_length': lengthInRange(
    'meta_description',
    advisories.meta_description_length,
  ),
  'aeo.thin_content': thinContent,
  'aeo.long_paragraphs': longParagraphs,
};
