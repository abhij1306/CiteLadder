/**
 * Every expected-check kind, and what derives from the rule catalog's
 * `check_kind`: the reading each member promises before declaration, the
 * readings an Action is measured with, and which sources read which kinds.
 */
import { policy } from '../../config.ts';
import { contextualLinkCheck } from './contextual-link.ts';
import { issueFamilyCheck } from './issue-family.ts';
import { keywordPresenceCheck } from './keyword-presence.ts';
import type { CheckKind, CheckModule, MeasurementLeg, MemberFacts, SourceKind } from './kind.ts';
import { ownedUrlCitedCheck } from './owned-url-cited.ts';
import { productMetricCheck } from './product-metric.ts';
import { siteRuleCheck } from './site-rule.ts';
import { trafficMetricCheck } from './traffic-metric.ts';
import { visibilityMetricCheck } from './visibility-metric.ts';

/** In freeze order: a declaration's checks are stored in this order. */
export const CHECKS: { readonly [K in CheckKind]: CheckModule<K> } = {
  visibility_metric: visibilityMetricCheck,
  site_rule: siteRuleCheck,
  issue_family: issueFamilyCheck,
  traffic_metric: trafficMetricCheck,
  keyword_presence: keywordPresenceCheck,
  contextual_link: contextualLinkCheck,
  owned_url_cited: ownedUrlCitedCheck,
  product_metric: productMetricCheck,
};

export const CHECK_KINDS = Object.values(CHECKS).map((check) => check.kind);
export const isCheckKind = (kind: unknown): kind is CheckKind =>
  typeof kind === 'string' && Object.hasOwn(CHECKS, kind);

const catalog: Readonly<Record<string, { check_kind: CheckKind | null }>> =
  policy.opportunity.opportunities.OPPORTUNITY_RULES_BY_ID;

/** The check kind a rule's findings freeze; null for a rule nothing measures. */
export const ruleCheckKind = (ruleId: string): CheckKind | null =>
  catalog[ruleId]?.check_kind ?? null;

/** The check kinds each source kind can read. */
export const SOURCE_CHECK_KINDS: Readonly<Record<SourceKind, readonly CheckKind[]>> = {
  site_crawl: CHECK_KINDS.filter((kind) => CHECKS[kind].sources.includes('site_crawl')),
  audit: CHECK_KINDS.filter((kind) => CHECKS[kind].sources.includes('audit')),
  traffic_snapshot: CHECK_KINDS.filter((kind) => CHECKS[kind].sources.includes('traffic_snapshot')),
  search_intelligence_dataset: CHECK_KINDS.filter((kind) =>
    CHECKS[kind].sources.includes('search_intelligence_dataset'),
  ),
};

/**
 * The reading that would measure a member once declared, or null when
 * nothing can: the same decision `freeze` makes, without its baselines.
 */
export function memberMeasurementLeg(member: MemberFacts): MeasurementLeg | null {
  const kind = ruleCheckKind(member.rule_id);
  if (kind === null) return null;
  const check: CheckModule<CheckKind> = CHECKS[kind];
  return check.measurable(member) ? check.leg : null;
}
