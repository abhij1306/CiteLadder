/**
 * Content gaps over one succeeded content-angle run (content optimization
 * section 2). An angle cited often enough across enough domains is a gap
 * unless its matched owned content page is already cited for its prompts:
 * with a matched page it is `content_gap_improve_page` on that page, without
 * one it is `content_gap_new_page` on the planned page its lineage keys.
 * Deterministic: counts come from the run, the model never scores. Pure.
 */
import {
  CONTENT_GAP_EVIDENCE_MEMBERS,
  type ContentGapImprovePageEvidence,
  type ContentGapNewPageEvidence,
} from '@citeladder/contracts/opportunity-evidence';

import { policy } from '../../config.ts';
import { compareText } from '../../text-order.ts';
import type { DetectorHit } from './evidence.ts';

const g = policy.opportunity.opportunities.CONTENT_GAP;
/** The gap thresholds (`min_citations`, `min_domains`). */
const t = policy.content_optimization;

/** The run a refresh reads gaps from. */
export type ContentGapRun = {
  id: string;
  window: { start: string; end: string };
  methodology_version: string;
  formula_version: string;
  limitations: Record<string, unknown>[];
};

type ContentGapMember = {
  url: string;
  title: string;
  domain: string;
  classification: string;
  matched_competitor: string | null;
  citation_count: number;
};

/** What an angle matched: an owned content page (and whether it is cited), or none. */
type AngleMatch =
  | { kind: 'page'; site_url_id: string; url: string; owned_cited: boolean }
  | {
      kind: 'none';
      /** The lineage's key, fixed when it was created; null when its label had no slug. */
      planned_page_key: string | null;
    };

export type ContentGapAngle = {
  id: string;
  lineage_id: string;
  label: string;
  topic_id: string | null;
  /** Each prompt with its library text at this refresh; null when the library no longer has it. */
  prompts: { id: string; text: string | null }[];
  engines: string[];
  citation_count: number;
  domain_count: number;
  competitor_count: number;
  members: ContentGapMember[];
  match: AngleMatch;
  /** The planned-page Action of this lineage an improve-page gap continues, if any. */
  continues_action_id: string | null;
};

const valueFactor = (prompts: number) =>
  Math.min(g.VALUE_FACTOR_CAP, 1 + Math.max(prompts - 1, 0) * g.VALUE_PER_EXTRA_PROMPT);

const gapFactor = (angle: ContentGapAngle) =>
  Math.min(
    g.GAP_FACTOR_CAP,
    1 +
      Math.log10(Math.max(angle.citation_count, 1)) +
      (g.COMPETITOR_SHARE_WEIGHT * Math.min(angle.competitor_count, angle.domain_count)) /
        Math.max(angle.domain_count, 1),
  );

function sharedEvidence(run: ContentGapRun, angle: ContentGapAngle) {
  const members = [...angle.members].sort(
    (a, b) => b.citation_count - a.citation_count || compareText(a.url, b.url),
  );
  return {
    run_id: run.id,
    lineage_id: angle.lineage_id,
    angle_label: angle.label,
    topic_id: angle.topic_id,
    prompts: angle.prompts,
    engines: angle.engines,
    citation_count: angle.citation_count,
    domain_count: angle.domain_count,
    competitor_count: angle.competitor_count,
    member_count: members.length,
    members: members.slice(0, CONTENT_GAP_EVIDENCE_MEMBERS),
    window: run.window,
    methodology_version: run.methodology_version,
    formula_version: run.formula_version,
    limitations: run.limitations,
  };
}

function gapHit(run: ContentGapRun, angle: ContentGapAngle): DetectorHit | null {
  const shared = {
    source_analysis_ids: [],
    source_issue_ids: [],
    // The run and the angle are the persisted readings the finding rests on.
    source_metric_ids: [run.id, angle.id].sort(compareText),
    value_factor: valueFactor(angle.prompts.length),
    gap_factor: gapFactor(angle),
  };
  const { match } = angle;
  switch (match.kind) {
    case 'page': {
      // A matched page already cited for the angle's prompts covers it.
      if (match.owned_cited) return null;
      return {
        ...shared,
        rule_id: g.RULE_IMPROVE_PAGE,
        target: { kind: 'site_page', url: match.url },
        evidence: {
          ...sharedEvidence(run, angle),
          site_url_id: match.site_url_id,
          url: match.url,
          match_method: 'model_pick',
          ...(angle.continues_action_id ? { continues_action_id: angle.continues_action_id } : {}),
        } satisfies ContentGapImprovePageEvidence,
      };
    }
    case 'none': {
      if (match.planned_page_key === null) return null;
      return {
        ...shared,
        rule_id: g.RULE_NEW_PAGE,
        target: { kind: 'planned_page', key: match.planned_page_key, label: angle.label },
        evidence: {
          ...sharedEvidence(run, angle),
          planned_page_key: match.planned_page_key,
        } satisfies ContentGapNewPageEvidence,
      };
    }
    default: {
      const unknownMatch: never = match;
      throw new Error(`Unknown angle match: ${JSON.stringify(unknownMatch)}`);
    }
  }
}

/** One hit per angle that clears both thresholds and is not already covered. */
export function detectContentGaps(
  run: ContentGapRun,
  angles: readonly ContentGapAngle[],
): DetectorHit[] {
  return angles.flatMap((angle) => {
    if (angle.citation_count < t.min_citations || angle.domain_count < t.min_domains) return [];
    const hit = gapHit(run, angle);
    return hit ? [hit] : [];
  });
}
