/** The rule catalog as the read API presents it: labels, routes, ranks and group identity. */
import { policy } from '../../config.ts';
import { sql } from 'kysely';
import { record } from '../../db/json.ts';
import { compareText } from '../../text-order.ts';
import { uuidV5 } from '../../uuid-v5.ts';

const reads = policy.site_health.reads;
const RULES = new Map(policy.site_health.rule_catalog.map((rule) => [rule.rule_id, rule]));

/** Whether the catalog defines this rule. */
export const isKnownRule = (ruleId: string) => RULES.has(ruleId);

/** Critical first; a severity the catalog no longer defines sorts after every known one. */
const SEVERITY_RANK = new Map(
  ['critical', 'high', 'medium', 'low', 'info'].map((severity, rank) => [severity, rank]),
);
const UNRANKED = 99;
export const severityRank = (severity: string) => SEVERITY_RANK.get(severity) ?? UNRANKED;

/** The same severity order at the database boundary, before limiting rows. */
export const severityOrder = (column: string) => sql<number>`case ${sql.ref(column)}
  ${sql.join(
    [...SEVERITY_RANK].map(([severity, rank]) => sql`when ${severity} then ${rank}`),
    sql` `,
  )}
  else ${UNRANKED} end`;

/** The current catalog label; a retired or unknown rule shows its id. */
export const ruleTitle = (ruleId: string) => RULES.get(ruleId)?.display_label ?? ruleId;

/** The catalog rules whose label contains the text, ignoring case. */
export function rulesTitled(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return [...RULES.values()]
    .filter((rule) => rule.display_label.toLowerCase().includes(needle))
    .map((rule) => rule.rule_id);
}

/** Who can resolve the rule; an unknown rule needs a developer. */
export const remediationRoute = (ruleId: string) =>
  RULES.get(ruleId)?.remediation_route ?? reads.unknown_rule_remediation_route;

export const ruleScoreRoles = (ruleId: string) =>
  [...(RULES.get(ruleId)?.score_roles ?? [])].sort(compareText);

/** A defect's band by severity; an advisory's by its readiness dimension's weight. */
export function issueImpact(ruleId: string, findingClass: string, severity: string) {
  const bands: Record<string, number> = reads.defect_impact_bands;
  if (findingClass === 'defect') {
    const label = severity.replaceAll('_', ' ').replace(/\b\w/gu, (c) => c.toUpperCase());
    return { band: bands[severity] ?? 0, label };
  }
  const pillar = (reads.aeo_check_pillar as Record<string, string>)[ruleId];
  if (findingClass !== 'advisory' || !RULES.has(ruleId) || pillar === undefined)
    return { band: 0, label: 'Advisory' };
  const weight = (reads.readiness_dimension_weights as Record<string, number>)[pillar]!;
  const label = (reads.aeo_dimension_labels as Record<string, string>)[pillar]!;
  return {
    band: Math.max(1, Math.round(weight * 10)),
    label: `${label} · ${Math.round(weight * 100)}%`,
  };
}

/**
 * One issue group's stable identity within a crawl. Links to defect groups
 * predate the finding-class suffix, so a defect keeps the unsuffixed name.
 */
export function issueGroupId(crawlId: string, ruleId: string, findingClass: string) {
  const suffix = findingClass === 'defect' ? '' : `:${findingClass}`;
  return uuidV5(crawlId, `site-issue-group:${ruleId}${suffix}`);
}

/**
 * A site-level architecture finding is persisted once, against the homepage,
 * and names the pages (or page kinds) it found in its evidence. Its group
 * counts and page kinds come from that evidence, not from the one row, so
 * "Pages buried too deeply" reads 11 pages rather than the homepage. `null`
 * for every per-page rule.
 */
export function siteLevelScope(
  ruleId: string,
  evidence: unknown,
): { affected: number; pageKinds: string[] } | null {
  if (!ruleId.startsWith('architecture.')) return null;
  const facts = record(evidence);
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
    const key =
      ruleId === 'architecture.duplicate_metadata_in_page_kind'
        ? 'duplicate_metadata_count'
        : 'page_count';
    const affected = kinds.reduce((sum, row) => {
      const value = row[key];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
    return { affected, pageKinds: kindsOf(kinds) };
  }
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
  finding_class: string;
  description: string;
  remediation: string;
  evidence: unknown;
  analyzer_version: string;
  rule_version: string;
  created_at: Date;
  reason_code: string;
};

/** One persisted issue occurrence on one page. */
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
  finding_class: issue.finding_class,
  issue_title: ruleTitle(issue.rule_id),
  description: issue.description,
  remediation: issue.remediation,
  reason_code: issue.reason_code,
  evidence: record(issue.evidence),
  analyzer_version: issue.analyzer_version,
  rule_version: issue.rule_version,
  created_at: issue.created_at.toISOString(),
});
