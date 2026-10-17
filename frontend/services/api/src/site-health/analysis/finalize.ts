/** Cross-page checks use only the persisted acquisition evidence supplied by the caller. */
import { policy } from '../../config.ts';
import { scalarText } from '../../text-order.ts';
import { onlyOf } from '../../lists.ts';
import { membership, type RuleEvaluation } from './rules.ts';

const limits = policy.site_health.page_analysis.facts.limits;
const bounded = (urls: string[]) =>
  urls.slice(0, limits.evidence_urls).map((url) => url.slice(0, limits.url_chars));

export function finalizeEvaluation(
  ruleId: string,
  outcome: string,
  evidence: Record<string, unknown>,
): RuleEvaluation {
  const rule = policy.site_health.rule_catalog.find((entry) => entry.rule_id === ruleId);
  if (!rule) throw new Error(`Missing finalize rule: ${ruleId}`);
  const { score_roles: roles, readiness_dimension: pillar } = membership(ruleId);
  return {
    rule_id: rule.rule_id,
    rule_version: rule.rule_version,
    dimension: rule.dimension,
    category: rule.category,
    severity: rule.severity,
    finding_class: rule.finding_class,
    scope: rule.scope,
    weight: rule.weight,
    description: rule.description,
    remediation: rule.remediation,
    outcome,
    evidence,
    display_applicability: outcome !== 'not_applicable',
    score_applicability: roles.length > 0 && outcome !== 'not_applicable',
    reason_code: scalarText(evidence.reason),
    score_roles: roles,
    readiness_dimension: pillar,
    readiness_weight: pillar ? 1 : 0,
  };
}

/** Incomplete coverage without an observed failure stays unknown, never a pass. */
function entityOutcome(failures: number, checked: number, total: number) {
  if (failures) return failures === checked ? 'missing' : 'partial';
  return checked < total ? 'unknown' : 'satisfied';
}

export function entitySetEvaluation(
  ruleId: string,
  totalCount: number,
  checkedCount: number,
  failingUrls: string[],
) {
  const total = Math.max(0, totalCount);
  const checked = Math.min(total, Math.max(0, checkedCount));
  const unique = [...new Set(failingUrls)];
  const failures = Math.min(checked, unique.length);
  if (!total)
    return finalizeEvaluation(ruleId, 'satisfied', {
      total_count: 0,
      checked_count: 0,
      normalized_score: 1,
      normalized_coverage: 1,
    });
  if (!checked)
    return finalizeEvaluation(ruleId, 'unknown', {
      reason: 'insufficient_evidence',
      total_count: total,
      checked_count: 0,
    });
  const outcome = entityOutcome(failures, checked, total);
  return finalizeEvaluation(ruleId, outcome, {
    total_count: total,
    checked_count: checked,
    failure_count: failures,
    failing_urls: bounded(unique),
    normalized_score: (checked - failures) / checked,
    normalized_coverage: checked / total,
  });
}

/**
 * A canonical must name the URL search engines should index: one declaration,
 * same origin, answering directly (no redirect), and, when this crawl analyzed
 * another target page, one that is indexable and names itself canonical. A
 * self-canonical, or a target fetched but not analyzed, is judged on its
 * response alone (`target_page_checked: false`).
 */
export function canonicalIntegrity(input: {
  declarations: string[];
  finalUrl: string;
  targetUrl: string;
  checked: boolean;
  statusCode: number | null;
  redirected: boolean;
  target?: { noindex: boolean; canonical: string | null } | null;
}) {
  const unique = [...new Set(input.declarations.map((value) => value.trim()).filter(Boolean))];
  const evidence = {
    declarations: bounded(unique),
    final_url: input.finalUrl,
    target_url: input.targetUrl,
    redirected: input.redirected,
  };
  const result = (outcome: string, reason: string) =>
    finalizeEvaluation('technical.canonical_integrity', outcome, { ...evidence, reason });
  if (!unique.length) return result('not_applicable', 'no_canonical');
  const only = onlyOf(unique);
  if (only === undefined) return result('missing', 'conflicting_declarations');
  try {
    const declared = new URL(only, input.finalUrl);
    const final = new URL(input.finalUrl);
    if (![declared, final].every((url) => ['http:', 'https:'].includes(url.protocol)))
      return result('missing', 'invalid_canonical');
    if (declared.origin !== final.origin) return result('missing', 'cross_origin_canonical');
  } catch {
    return result('missing', 'invalid_canonical');
  }
  if (!input.checked || input.statusCode === null)
    return result('unknown', 'insufficient_evidence');
  const observed = { ...evidence, status_code: input.statusCode };
  const failed = (reason: string) =>
    finalizeEvaluation('technical.canonical_integrity', 'missing', { ...observed, reason });
  if (input.statusCode >= 400) return failed('canonical_target_error');
  if (input.redirected) return failed('canonical_target_redirects');
  const target = input.target;
  if (target?.noindex) return failed('canonical_target_noindex');
  if (target?.canonical && target.canonical !== input.targetUrl)
    return finalizeEvaluation('technical.canonical_integrity', 'missing', {
      ...observed,
      reason: 'canonical_chain',
      target_canonical_url: target.canonical,
    });
  return finalizeEvaluation('technical.canonical_integrity', 'satisfied', {
    ...observed,
    target_page_checked: Boolean(target),
  });
}

export function sitemapOrphan(count: number, orphans: string[], coverage: string) {
  const rule = 'technical.sitemap_orphan';
  if (coverage !== 'complete')
    return finalizeEvaluation(rule, 'unknown', {
      reason: 'coverage_not_complete',
      coverage_state: coverage,
    });
  if (!count) return finalizeEvaluation(rule, 'not_applicable', { reason: 'no_sitemap' });
  return finalizeEvaluation(rule, orphans.length ? 'missing' : 'satisfied', {
    sitemap_url_count: count,
    orphan_count: orphans.length,
    orphan_urls: bounded(orphans),
  });
}

export function hreflangConflict(input: {
  alternateCount: number;
  checkedCount: number;
  uncheckedCount: number;
  missingReturnTags: string[];
  rateLimitedCount: number;
}) {
  const rule = 'technical.hreflang_conflict';
  const counts = { alternate_count: input.alternateCount, unchecked_count: input.uncheckedCount };
  if (!input.alternateCount)
    return finalizeEvaluation(rule, 'not_applicable', { reason: 'no_hreflang' });
  if (input.rateLimitedCount && !input.missingReturnTags.length)
    return finalizeEvaluation(rule, 'unknown', {
      ...counts,
      reason: 'rate_limited_alternates',
      checked_count: input.checkedCount,
      rate_limited_count: input.rateLimitedCount,
    });
  if (!input.checkedCount)
    return finalizeEvaluation(rule, 'unknown', {
      ...counts,
      reason: 'no_checkable_alternates',
    });
  return finalizeEvaluation(rule, input.missingReturnTags.length ? 'missing' : 'satisfied', {
    ...counts,
    checked_count: input.checkedCount,
    missing_return_tags: bounded(input.missingReturnTags),
  });
}
