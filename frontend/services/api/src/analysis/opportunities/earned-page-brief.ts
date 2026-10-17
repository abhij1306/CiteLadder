import { policy } from '../../config.ts';
import type { EarnedPageEvidence, SourcePageEvidence } from './evidence.ts';
const p = policy.opportunity.earned_actions;
const s = policy.opportunity.source_pages;
export const brandOf = (page: SourcePageEvidence) =>
  page.entities.find((e) => e.entity_kind === s.ENTITY_KIND_BRAND);
export const competitorsOf = (page: SourcePageEvidence) =>
  page.entities.filter(
    (e) => e.entity_kind === s.ENTITY_KIND_COMPETITOR && e.presence === s.PRESENCE_PRESENT,
  );
function limitations(evidence: EarnedPageEvidence): string[] {
  const result = [
    "Inclusion is the publisher's decision. Visibility on the prompts that cite this page is measured after you declare the work; it can move for other reasons too.",
    'No passage can demonstrate an absence. The brand was not found in the readable text of this page; the extracted length says how much was read.',
  ];
  if (evidence.total_pages && evidence.inspected_pages < evidence.total_pages)
    result.push(
      `${evidence.inspected_pages} of ${evidence.total_pages} cited pages in this project have been read; the rest are inventory, not findings.`,
    );
  return result;
}

/**
 * What the Agent needs to draft the request: the page, who is on it in its
 * own words, the prompts it answers, and what to ask for. Prompt IDs travel
 * so a declaration can freeze checks on exactly those prompts.
 */
export function earnedPageBrief(page: SourcePageEvidence, evidence: EarnedPageEvidence) {
  const listed = competitorsOf(page);
  const names = listed.slice(0, p.EARNED_PAGE_MAX_COMPETITORS).map((e) => e.entity_name);
  return {
    pathway: p.ACTION_PATH_EARNED,
    rule_id: p.RULE_EARNED_PAGE_ACQUIRE,
    target_url: page.canonical_url,
    url_hash: page.url_hash,
    canonical_domain: page.registrable_domain,
    source_class: page.source_class,
    page_format: page.page_format,
    page_format_method: page.page_format_method,
    page_title: page.title,
    target_theme: page.themes[0] ?? null,
    // Outreach to a publisher, not owned content.
    suggested_skill_id: 'earned_authority',
    suggested_role: 'PR',
    ask: `Be included on this page alongside ${names.join(', ')}, with an entry comparable to theirs that links to your site.`,
    snapshot_id: page.snapshot_id,
    read_at: page.read_at,
    extracted_chars: page.extracted_chars,
    page_entities: page.entities.map((e) => ({
      entity_kind: e.entity_kind,
      entity_name: e.entity_name,
      presence: e.presence,
      match_method: e.match_method,
      match_count: e.match_count,
      passages: e.passages.slice(0, p.EARNED_PAGE_MAX_PASSAGES),
    })),
    observed_competitors: names,
    answer_competitors: page.answer_competitors.slice(0, p.EARNED_PAGE_MAX_COMPETITORS),
    affected_prompts: page.prompts.slice(0, p.EARNED_PAGE_MAX_PROMPTS),
    affected_themes: page.themes.slice(0, p.EARNED_PAGE_MAX_PROMPTS),
    observed_citation_frequency: {
      answers_citing_page: page.answer_count,
      eligible_answers: evidence.eligible_answers,
    },
    coverage: { inspected_pages: evidence.inspected_pages, total_pages: evidence.total_pages },
    truncated:
      page.prompts.length > p.EARNED_PAGE_MAX_PROMPTS ||
      page.answer_competitors.length > p.EARNED_PAGE_MAX_COMPETITORS ||
      listed.length > p.EARNED_PAGE_MAX_COMPETITORS ||
      page.entities.some((e) => e.passages.length > p.EARNED_PAGE_MAX_PASSAGES),
    source_analysis_ids: [...page.analysis_ids],
    limitations: limitations(evidence),
    inspector_version: s.SOURCE_PAGE_INSPECTOR_VERSION,
    presence_version: s.SOURCE_PAGE_PRESENCE_VERSION,
    page_format_version: s.SOURCE_PAGE_FORMAT_VERSION,
    handoff_template_version: policy.opportunity.source_patterns.CONTENT_HANDOFF_TEMPLATE_VERSION,
  };
}
