import { issueSectionSchema, type IssueSection } from '@citeladder/contracts/site-health';
import { policy } from '../../config.ts';
import { sql } from 'kysely';
import { z } from 'zod';
import { record } from '../../db/json.ts';
import { compareText } from '../../text-order.ts';
import { uuidV5 } from '../../uuid-v5.ts';

const reads = policy.site_health.reads;
const RULES = new Map(policy.site_health.rule_catalog.map((rule) => [rule.rule_id, rule]));

export const isKnownRule = (ruleId: string) => RULES.has(ruleId);

const SEVERITY_RANK = new Map(
  ['critical', 'high', 'medium', 'low', 'info'].map((severity, rank) => [severity, rank]),
);
const UNRANKED = 99;
export const severityRank = (severity: string) => SEVERITY_RANK.get(severity) ?? UNRANKED;

export const severityOrder = (column: string) => sql<number>`case ${sql.ref(column)}
  ${sql.join(
    [...SEVERITY_RANK].map(([severity, rank]) => sql`when ${severity} then ${rank}`),
    sql` `,
  )}
  else ${UNRANKED} end`;

export const ruleTitle = (ruleId: string) => RULES.get(ruleId)?.display_label ?? ruleId;

export const ruleRemediation = (ruleId: string) => RULES.get(ruleId)?.remediation ?? null;

export function rulesTitled(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return [...RULES.values()]
    .filter((rule) => rule.display_label.toLowerCase().includes(needle))
    .map((rule) => rule.rule_id);
}

export const remediationRoute = (ruleId: string) =>
  RULES.get(ruleId)?.remediation_route ?? reads.unknown_rule_remediation_route;

export const ruleScoreRoles = (ruleId: string) =>
  [...(RULES.get(ruleId)?.score_roles ?? [])].sort(compareText);

const SECTION_BY_CATEGORY: Readonly<Record<string, IssueSection>> = z
  .record(z.string(), issueSectionSchema)
  .parse(reads.issue_section_by_category);

export const issueSection = (issue: { dimension: string; category: string }): IssueSection =>
  SECTION_BY_CATEGORY[issue.category] ?? issueSectionSchema.parse(issue.dimension);

export function ruleSection(ruleId: string): IssueSection | null {
  const rule = RULES.get(ruleId);
  return rule ? issueSection(rule) : null;
}

export function issueImpact(severity: string) {
  const bands: Record<string, number> = reads.severity_impact_bands;
  const label = severity.replaceAll('_', ' ').replace(/\b\w/gu, (c) => c.toUpperCase());
  return { band: bands[severity] ?? 0, label };
}

export function issueGroupId(crawlId: string, ruleId: string) {
  return uuidV5(crawlId, `site-issue-group:${ruleId}`);
}

const sitewideLinkRules: readonly string[] = [
  'technical.sitewide_broken_link',
  'technical.sitewide_link_redirect',
];
const SITEWIDE_LINK_RULES = new Set(sitewideLinkRules);

export function siteLevelScope(
  ruleId: string,
  evidence: unknown,
  pageKind: string | null = null,
): { affected: number; pageKinds: string[] } | null {
  const scope = wholeSiteScope(ruleId, evidence);
  if (scope === null || pageKind === null) return scope;
  const counted = record(record(evidence).page_kind_counts)[pageKind];
  return { ...scope, affected: typeof counted === 'number' ? counted : 0 };
}

export const isSiteLevelRule = (ruleId: string) =>
  ruleId.startsWith('architecture.') || SITEWIDE_LINK_RULES.has(ruleId);

export const siteLevelRuleOf = (alias: string) => {
  const rule = sql.ref(`${alias}.rule_id`);
  return sql`(${rule} like 'architecture.%' or ${rule} = any(${sitewideLinkRules}::text[]))`;
};
export const siteLevelRule = siteLevelRuleOf('i');

function wholeSiteScope(
  ruleId: string,
  evidence: unknown,
): { affected: number; pageKinds: string[] } | null {
  const facts = record(evidence);
  if (SITEWIDE_LINK_RULES.has(ruleId)) {
    if (typeof facts.count !== 'number') return null;
    const kinds = Array.isArray(facts.linking_page_kinds) ? facts.linking_page_kinds : [];
    return {
      affected: facts.count,
      pageKinds: kinds.filter((kind): kind is string => typeof kind === 'string'),
    };
  }
  if (!ruleId.startsWith('architecture.')) return null;
  const rows = (value: unknown) =>
    Array.isArray(value) ? value.map(record).filter((row) => Object.keys(row).length > 0) : [];
  const kindsOf = (items: Record<string, unknown>[]) =>
    [
      ...new Set(items.map((row) => row.page_kind).filter((kind): kind is string => Boolean(kind))),
    ].sort(compareText);
  if (Array.isArray(facts.pages)) {
    const pages = rows(facts.pages);
    const count = typeof facts.count === 'number' ? facts.count : pages.length;
    return { affected: count, pageKinds: kindsOf(pages) };
  }
  if (Array.isArray(facts.page_kinds)) {
    const kinds = rows(facts.page_kinds);
    const affected = kinds.reduce((sum, row) => {
      const value = row.page_count;
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
    return { affected, pageKinds: kindsOf(kinds) };
  }
  if (Array.isArray(facts.duplicate_sets) && typeof facts.count === 'number')
    return {
      affected: facts.count,
      pageKinds: Object.keys(record(facts.page_kind_counts)).sort(compareText),
    };
  return null;
}

export type IssueRow = {
  id: string;
  evaluation_id: string;
  crawl_id: string;
  rule_id: string;
  dimension: string;
  category: string;
  severity: string;
  description: string;
  remediation: string;
  evidence: unknown;
  analyzer_version: string;
  rule_version: string;
  created_at: Date;
  reason_code: string;
};

export const issueOccurrence = (
  issue: IssueRow,
  page: {
    site_url_id: string;
    normalized_url: string;
    display_url: string;
    title: string | null;
    page_kind: string | null;
  },
) => ({
  occurrence_id: issue.id,
  evaluation_id: issue.evaluation_id,
  crawl_id: issue.crawl_id,
  rule_id: issue.rule_id,
  site_url_id: page.site_url_id,
  normalized_url: page.normalized_url,
  display_url: page.display_url || page.normalized_url,
  title: page.title || null,
  page_kind: page.page_kind,
  dimension: issue.dimension,
  category: issue.category,
  severity: issue.severity,
  issue_title: ruleTitle(issue.rule_id),
  description: issue.description,
  remediation: issue.remediation,
  reason_code: issue.reason_code,
  evidence: record(issue.evidence),
  analyzer_version: issue.analyzer_version,
  rule_version: issue.rule_version,
  created_at: issue.created_at.toISOString(),
});
