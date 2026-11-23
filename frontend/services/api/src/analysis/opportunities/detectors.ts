import { policy } from '../../config.ts';
import type {
  AnalysisEvidence,
  DetectorHit,
  PromptSnapshotEvidence,
  SiteEvidence,
  VisibilityEvidence,
} from './evidence.ts';
import {
  gapFactorVisibility,
  recommendationStrengthFactor,
  valueFactorForPrompt,
} from './scoring.ts';
import { summarizeSourcePattern } from './source-patterns.ts';
import { compareText } from '../../text-order.ts';
import { issueGroupId, ruleRemediation, ruleTitle } from '../../site-health/reads/rules.ts';
import { widen } from '../../widen.ts';
const p = policy.opportunity.opportunities;
export const rules = widen<
  Record<string, (typeof p.OPPORTUNITY_RULES_BY_ID)[keyof typeof p.OPPORTUNITY_RULES_BY_ID]>
>(p.OPPORTUNITY_RULES_BY_ID);
const sortedUnique = (values: string[]) => [...new Set(values)].sort(compareText);
function gapHit(
  e: VisibilityEvidence,
  rule: string,
  index: number,
  rows: AnalysisEvidence[],
  snapshot: PromptSnapshotEvidence | undefined,
  competitors: string[],
): DetectorHit {
  const [value, source, key] = valueFactorForPrompt(
    snapshot?.buyer_stage ?? '',
    snapshot?.prompt_intent ?? '',
    snapshot?.intent ?? '',
  );
  const strength = recommendationStrengthFactor(
    rows.flatMap((a) => a.entity_assessments).filter((a) => a.entity_kind === 'competitor'),
  );
  const engines = sortedUnique(rows.map((a) => a.logical_engine).filter(Boolean));
  return {
    rule_id: rule,
    target:
      snapshot?.prompt_id != null
        ? { kind: 'prompt', prompt_id: snapshot.prompt_id, theme: snapshot.theme || null }
        : {
            kind: 'prompt_index',
            audit_id: e.audit_id,
            prompt_index: index,
            theme: snapshot?.theme || null,
          },
    evidence: {
      prompt_text: snapshot?.text ?? '',
      prompt_intent: snapshot?.intent ?? '',
      buyer_stage: snapshot?.buyer_stage ?? '',
      new_prompt_intent: snapshot?.prompt_intent ?? '',
      prompt_theme: snapshot?.theme ?? '',
      prompt_index: index,
      repetitions: rows.length,
      observed_engines: engines,
      brand_mentioned: rows.some((a) => a.brand_mentioned),
      owned_citation_count: 0,
      source_pattern: summarizeSourcePattern(rows.flatMap((a) => a.citations)),
      ...(rule === 'brand_absent_high_value_prompt'
        ? { competitor_names: competitors, engines }
        : { owned_domains: [...e.owned_domains].sort(compareText) }),
      audit_id: e.audit_id,
      priority_factors: {
        value_factor: value,
        value_source: source,
        value_key: key,
        recommendation_strength_factor: strength,
      },
    },
    source_analysis_ids: rows.map((a) => a.analysis_id).sort(compareText),
    source_issue_ids: [],
    source_metric_ids: [],
    value_factor: value,
    gap_factor: gapFactorVisibility(competitors.length, 0, strength),
  };
}
function visibilityGaps(e: VisibilityEvidence, rule: string, absent: boolean): DetectorHit[] {
  if (!rules[rule]!.enabled || (!absent && !e.owned_domains.length)) return [];
  const snapshots = new Map(e.prompt_snapshots.map((s) => [s.prompt_index, s]));
  const groups = new Map<number, AnalysisEvidence[]>();
  for (const row of e.analyses) {
    const group = groups.get(row.prompt_index) ?? [];
    group.push(row);
    groups.set(row.prompt_index, group);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, rows]) => {
      const competitors = sortedUnique(rows.flatMap((a) => a.competitor_names).filter(Boolean));
      if (
        rows.some((a) => a.owned_citation_count > 0) ||
        (absent && (rows.some((a) => a.brand_mentioned) || !competitors.length))
      )
        return [];
      return [gapHit(e, rule, index, rows, snapshots.get(index), competitors)];
    });
}
export const detectBrandAbsentHighValuePrompt = (e: VisibilityEvidence) =>
  visibilityGaps(e, 'brand_absent_high_value_prompt', true);
export const detectOwnedPageNotCited = (e: VisibilityEvidence) =>
  visibilityGaps(e, 'owned_page_not_cited', false);

const family = p.SITE_ISSUE_FAMILY;

export function detectIssueGroups(e: SiteEvidence): DetectorHit[] {
  if (!rules[family.RULE_ID]!.enabled) return [];
  return e.families
    .toSorted((left, right) => compareText(left.rule_id, right.rule_id))
    .map((found) => {
      const label = ruleTitle(found.rule_id);
      return {
        rule_id: family.RULE_ID,
        target: { kind: 'issue_family', rule_id: found.rule_id, label },
        evidence: {
          issue_rule_id: found.rule_id,
          issue_severity: found.severity,
          category: found.category,
          cohort: {
            rule_id: found.rule_id,
            rule_label: label,
            crawl_id: e.crawl_id,
            group_id: issueGroupId(e.crawl_id, found.rule_id),
            page_count: found.page_count,
            whole_site: found.whole_site,
            pages: found.pages,
          },
          coverage: e.coverage,
          limitations: [...e.limitations],
        },
        source_analysis_ids: [],
        source_issue_ids: sortedUnique(found.issue_ids),
        source_metric_ids: [],
        value_factor: p.SITE_VALUE_FACTOR,
        gap_factor: p.SITE_GAP_FACTOR,
        finding: {
          severity: found.severity,
          title: label,
          remediation: ruleRemediation(found.rule_id) ?? '',
        },
      };
    });
}
