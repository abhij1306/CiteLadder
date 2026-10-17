/**
 * Evaluates the config-owned Site Health rule catalog against one page's facts.
 * Applicability (which rules a page answers to) is separate from outcome, and
 * an unanswerable check is unknown rather than failed. Crawl-finalize rules
 * belong to finalization and are not evaluated per page.
 */
import { policy } from '../../config.ts';
import { contentChecks, type CompositeContract } from './content-checks.ts';
import { DELIVERY_CHECKS, serverRenderSignals } from './delivery-checks.ts';
import {
  checkClientSideRedirect,
  checkIndexable,
  checkSitemapCanonical,
  checkSitemapLastmod,
  checkSitemapRedirect,
  type CheckResult,
} from './indexing.ts';
import { analysisPolicy } from './policy.ts';
import { record, text, textList, type Facts } from './read-facts.ts';
import { SCHEMA_CHECKS } from './schema-checks.ts';

type Rule = (typeof policy.site_health.rule_catalog)[number];
const CATALOG: readonly Rule[] = policy.site_health.rule_catalog;
const RULES = new Map(CATALOG.map((rule) => [rule.rule_id, rule]));
const r = analysisPolicy.rules;
const prefixes = r.applicability_prefixes;
const PILLARS: Record<string, string> = policy.site_health.reads.aeo_check_pillar;
const PAGE_KINDS = new Set(analysisPolicy.classification.page_kinds);
const STRUCTURAL_NA = new Set(r.structural_na_reasons);
const UNKNOWN_REASONS = new Set([...r.unavailable_reasons, ...r.unknown_reasons]);
const FAILING = new Set(policy.site_health.reads.failing_outcomes);
const AUTHORED_CHECKS = new Set(r.authored_content_check_ids);
const PURPOSE_CHECKS = new Set(r.purpose_confirmed_check_ids);
const PURPOSE_KINDS = new Set(r.purpose_confirmed_page_kinds);

/** Page-owned commerce structure: a purchase control or price, or a captured collection. */
function ownsPurpose(kind: string, facts: Facts) {
  if (record(facts.page_kind_evidence).tier === 'structural') return true;
  const entity = record(facts.entity);
  if (kind === 'product') {
    const product = record(entity.product);
    return Boolean(product.has_purchase_control || product.has_primary_price);
  }
  // The empty default carries the same keys, so only captured items confirm a collection.
  const container = record(record(record(entity.listing).collection_evidence).container);
  return Number(container.item_count) > 0;
}

/**
 * A product or category purpose check asserts what that page must offer. When
 * only the URL or title suggested that purpose (no page-owned commerce
 * structure), its failure is unknown rather than a finding.
 */
const purposeUnconfirmed = (rule: Rule, facts: Facts) =>
  PURPOSE_CHECKS.has(rule.rule_id) &&
  PURPOSE_KINDS.has(pageKind(facts)) &&
  typeof record(facts.page_kind_evidence).tier === 'string' &&
  !ownsPurpose(pageKind(facts), facts);

export type RuleEvaluation = {
  rule_id: string;
  rule_version: string;
  dimension: string;
  category: string;
  severity: string;
  finding_class: string;
  scope: string;
  weight: number;
  outcome: string;
  evidence: Record<string, unknown>;
  description: string;
  remediation: string;
  display_applicability: boolean;
  score_applicability: boolean;
  reason_code: string;
  score_roles: string[];
  readiness_dimension: string;
  readiness_weight: number;
};

/** Evidence-backed findings become issues, independently of score membership. */
export const createsIssue = (evaluation: RuleEvaluation) =>
  FAILING.has(evaluation.outcome) &&
  evaluation.finding_class !== 'diagnostic' &&
  evaluation.display_applicability;

function composite(ruleId: string): CompositeContract {
  const contract = RULES.get(ruleId)?.composite_contract;
  if (!contract) throw new Error(`Composite contract missing for ${ruleId}`);
  return contract;
}
const CHECKS: Record<string, (facts: Facts) => CheckResult> = {
  'technical.indexable': checkIndexable,
  'technical.sitemap_canonical': checkSitemapCanonical,
  'technical.sitemap_redirect': checkSitemapRedirect,
  'technical.sitemap_lastmod': checkSitemapLastmod,
  'technical.client_side_redirect': checkClientSideRedirect,
  ...DELIVERY_CHECKS,
  ...SCHEMA_CHECKS,
  ...contentChecks(composite),
};

const pageKind = (facts: Facts) => text(facts.page_kind).trim().toLowerCase();
const traitsOf = (facts: Facts) => new Set(textList(facts.page_traits));
const tokensAfter = (key: string, prefix: string) =>
  new Set(key.slice(prefix.length).split('|').filter(Boolean));

function observedContent(facts: Facts): [boolean, string] {
  if (!facts.has_html) return [false, 'no_html'];
  return [!serverRenderSignals(facts)[0], 'content_not_server_rendered'];
}
function requirement(kind: '' | 'html' | 'content', facts: Facts): [boolean, string] {
  if (kind === 'content') return observedContent(facts);
  if (kind === 'html') return [Boolean(facts.has_html), 'no_html'];
  return [true, ''];
}

/** Prefixed page-kind and trait scopes; null when the key is not prefixed. */
function prefixedScope(key: string, facts: Facts): [boolean, string] | null {
  if (key.startsWith(prefixes.page_kind_or_trait_content)) {
    const tokens = tokensAfter(key, prefixes.page_kind_or_trait_content);
    const applies =
      (PAGE_KINDS.has(pageKind(facts)) && tokens.has(pageKind(facts))) ||
      [...traitsOf(facts)].some((trait) => tokens.has(trait));
    return applies ? observedContent(facts) : [false, 'trait_not_observed'];
  }
  const kindScopes = [
    [prefixes.page_kind_content, 'content'],
    [prefixes.page_kind_html, 'html'],
    [prefixes.page_kind, ''],
  ] as const;
  for (const [prefix, needs] of kindScopes) {
    if (!key.startsWith(prefix)) continue;
    if (!PAGE_KINDS.has(pageKind(facts)) || !tokensAfter(key, prefix).has(pageKind(facts)))
      return [false, 'other_page_kind'];
    return requirement(needs, facts);
  }
  const traitScopes = [
    [prefixes.page_trait_content, 'content'],
    [prefixes.page_trait, ''],
  ] as const;
  for (const [prefix, needs] of traitScopes) {
    if (!key.startsWith(prefix)) continue;
    const tokens = tokensAfter(key, prefix);
    if (![...traitsOf(facts)].some((trait) => tokens.has(trait)))
      return [false, 'trait_not_observed'];
    return requirement(needs, facts);
  }
  return null;
}

/** Whether a rule applies to this page, and the persisted reason when it does not. */
function applicability(rule: Rule, facts: Facts): [boolean, string] {
  const key = (rule.applicability_key || 'always').trim().toLowerCase();
  if (key === 'always') return [true, ''];
  if (key === 'has_html') return [Boolean(facts.has_html), 'no_html'];
  if (key === 'observed_content') return observedContent(facts);
  const scoped = prefixedScope(key, facts);
  if (scoped) {
    if (
      scoped[0] &&
      AUTHORED_CHECKS.has(rule.rule_id) &&
      facts.authored_content !== true &&
      !text(record(facts.authorship).visible_byline).trim() &&
      record(facts.source_support).research_sensitive !== true
    )
      return [false, 'authored_content_unconfirmed'];
    return scoped;
  }
  if (key === 'site_root')
    return [facts.site !== undefined && facts.site !== null, 'not_site_root'];
  if (key === 'crawl_finalize') return [false, 'crawl_finalize_scope'];
  return [false, 'unknown_applicability'];
}

/** Score membership from the catalog's `score_roles`, the single source (validated at startup). */
export function membership(ruleId: string) {
  const roles = [...(RULES.get(ruleId)?.score_roles ?? [])];
  const pillar = roles.includes('aeo_readiness') ? (PILLARS[ruleId] ?? '') : '';
  return {
    score_applicability: roles.length > 0,
    score_roles: roles,
    readiness_dimension: pillar,
    readiness_weight: pillar ? 1 : 0,
  };
}
const NOT_SCORED = {
  score_applicability: false,
  score_roles: [],
  readiness_dimension: '',
  readiness_weight: 0,
};

/** Not-applicable keeps only structural reasons; anything else is unknown, not absent. */
function normalized(
  rule: Rule,
  outcome: string,
  evidence: Record<string, unknown>,
): [string, string] {
  if (
    rule.rule_id === 'technical.indexable' &&
    outcome === 'missing' &&
    evidence.indexing_intent === 'unknown'
  ) {
    evidence.reason = 'insufficient_evidence';
    return ['unknown', 'insufficient_evidence'];
  }
  const reason = text(evidence.reason);
  if (outcome !== 'not_applicable') return [outcome, reason];
  if (UNKNOWN_REASONS.has(reason)) return ['unknown', reason];
  if (STRUCTURAL_NA.has(reason)) return [outcome, reason];
  evidence.reason = reason || 'insufficient_evidence';
  return ['unknown', text(evidence.reason)];
}

const needsExtraction = (rule: Rule) =>
  rule.applicability_key.includes('html') || rule.applicability_key.includes('content');

function runCheck(
  rule: Rule,
  facts: Facts,
): Pick<RuleEvaluation, 'outcome' | 'evidence' | 'reason_code'> {
  const check = CHECKS[rule.rule_id];
  if (!check)
    return {
      outcome: 'error',
      evidence: { error: 'no_check_mapped' },
      reason_code: 'no_check_mapped',
    };
  let result: CheckResult;
  try {
    result = check(facts);
  } catch (error) {
    // An unexpected check failure is evidence about the check, not an aborted page.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {
      outcome: 'error',
      evidence: { error: message.slice(0, 512) },
      reason_code: 'check_error',
    };
  }
  let [outcome] = result;
  const evidence = result[1];
  if (outcome === 'missing' && record(facts.extraction).truncated && needsExtraction(rule)) {
    outcome = 'unknown';
    evidence.reason = 'extraction_truncated';
  }
  if (FAILING.has(outcome) && purposeUnconfirmed(rule, facts)) {
    outcome = 'unknown';
    evidence.reason = 'page_kind_unconfirmed';
  }
  const [final, reason] = normalized(rule, outcome, evidence);
  return { outcome: final, evidence, reason_code: reason };
}

function evaluateRule(rule: Rule, facts: Facts): RuleEvaluation {
  const base = {
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
  };
  const [applies, skip] = applicability(rule, facts);
  if (!applies) {
    const evidence: Record<string, unknown> = { reason: skip || 'unknown_applicability' };
    const [outcome, reason] = normalized(rule, 'not_applicable', evidence);
    const inapplicable = outcome === 'not_applicable';
    return {
      ...base,
      ...(inapplicable ? NOT_SCORED : membership(rule.rule_id)),
      outcome,
      evidence,
      display_applicability: !inapplicable,
      reason_code: reason,
    };
  }
  const extraction = record(facts.extraction);
  const state = text(extraction.state);
  if (state && state !== 'available' && needsExtraction(rule)) {
    const reason = text(extraction.reason) || 'extraction_unavailable';
    return {
      ...base,
      ...membership(rule.rule_id),
      outcome: 'unknown',
      evidence: { reason },
      display_applicability: true,
      reason_code: reason,
    };
  }
  return {
    ...base,
    ...membership(rule.rule_id),
    ...runCheck(rule, facts),
    display_applicability: true,
  };
}

/** Every page-scoped rule in catalog order. */
export const evaluatePageRules = (facts: Facts) =>
  CATALOG.filter((rule) => rule.applicability_key !== 'crawl_finalize').map((rule) =>
    evaluateRule(rule, facts),
  );
