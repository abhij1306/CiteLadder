import { policy } from '../../config.ts';
import { rules } from './detectors.ts';
import { brandOf, competitorsOf, earnedPageBrief } from './earned-page-brief.ts';
import type { DetectorHit, EarnedPageEvidence, SourcePageEvidence } from './evidence.ts';
import { pageCompetitorPresenceFactor, pageRecurrenceFactor } from './scoring.ts';
import { compareText } from '../../text-order.ts';
const p = policy.opportunity.earned_actions;
const s = policy.opportunity.source_pages;

/** The Opportunity and Action target for one page. */
export const earnedTargetKey = (urlHash: string) => `${p.EARNED_PAGE_TARGET_PREFIX}${urlHash}`;

/**
 * A page earns the Action when it was read well enough to trust an absence,
 * answers to tracked prompts keep citing it, it is the kind of page that takes
 * another entry, and at least one competitor is on it while the brand is not.
 */
function qualifies(page: SourcePageEvidence): boolean {
  return (
    page.snapshot_id !== null &&
    page.sufficient_coverage &&
    page.roster_current &&
    page.prompts.length > 0 &&
    Math.max(page.recurrence_count, page.answer_count) >= p.EARNED_PAGE_MIN_RECURRENCE &&
    !p.EARNED_EXCLUDED_SOURCE_CLASSES.includes(page.source_class ?? '') &&
    p.EARNED_PAGE_INCLUDABLE_FORMATS.includes(page.page_format) &&
    competitorsOf(page).length > 0 &&
    brandOf(page)?.presence === s.PRESENCE_NOT_DETECTED
  );
}

export function detectEarnedPageOpportunities(evidence: EarnedPageEvidence): DetectorHit[] {
  if (!rules[p.RULE_EARNED_PAGE_ACQUIRE]!.enabled) return [];
  return evidence.pages
    .filter(qualifies)
    .sort((a, b) => compareText(a.url_hash, b.url_hash))
    .map((page) => {
      const value = pageRecurrenceFactor(page.answer_count, evidence.eligible_answers);
      const gap = pageCompetitorPresenceFactor(competitorsOf(page).length);
      return {
        rule_id: p.RULE_EARNED_PAGE_ACQUIRE,
        target_key: earnedTargetKey(page.url_hash),
        target_prompt_id: null,
        target_url: page.canonical_url,
        target_theme: page.themes[0] ?? null,
        evidence: {
          content_handoff: earnedPageBrief(page, evidence),
          priority_factors: {
            page_recurrence_factor: value,
            page_competitor_presence_factor: gap,
          },
        },
        source_analysis_ids: [...page.analysis_ids],
        source_issue_ids: [],
        source_metric_ids: [],
        value_factor: value,
        gap_factor: gap,
      };
    });
}
