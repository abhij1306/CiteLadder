import { policy } from '../../config.ts';
import { isListingGap } from '../listing-gap.ts';
import { rules } from './detectors.ts';
import { competitorsOf, earnedPageBrief } from './earned-page-brief.ts';
import type { DetectorHit, EarnedPageEvidence, SourcePageEvidence } from './evidence.ts';
import { pageCompetitorPresenceFactor, pageRecurrenceFactor } from './scoring.ts';
import { compareText } from '../../text-order.ts';
const p = policy.opportunity.earned_actions;

/**
 * Every page the URLs table shows as a Gap earns the Action (AS4): its latest
 * successful reading is a listing gap. Its format, how often it is cited and
 * how much of it was read only rank it, through the priority factors.
 */
function qualifies(page: SourcePageEvidence): boolean {
  return page.snapshot_id !== null && isListingGap(page, page.entities);
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
        target: {
          kind: 'earned_page',
          url_hash: page.url_hash,
          url: page.canonical_url,
          theme: page.themes[0] ?? null,
        },
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
