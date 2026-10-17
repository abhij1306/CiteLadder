/** Binary scoring of the public checklist: Web Fundamentals and weighted AEO readiness. */
import { policy } from '../../config.ts';
import { finalizeEvaluation } from './finalize.ts';
import { analysisPolicy } from './policy.ts';
import { membership, type RuleEvaluation } from './rules.ts';

const reads = policy.site_health.reads;
const LABELS: Record<string, string> = reads.aeo_dimension_labels;
const DESCRIPTIONS: Record<string, string> = reads.aeo_dimension_descriptions;
const WEIGHTS: Record<string, number> = reads.readiness_dimension_weights;
const DIMENSIONS = analysisPolicy.rules.aeo_dimensions;
const PAGE_KINDS = new Set(analysisPolicy.classification.page_kinds);
const DETERMINATE = new Set(['satisfied', 'missing']);

/**
 * The crawl's site-level checks that applied (evaluated where the site facts
 * were observed). A blocked crawler makes every page ineligible, so each page
 * scores these in place of its own site rows.
 */
export const appliedSiteChecks = (rows: RuleEvaluation[]) =>
  rows.filter((row) => row.scope === 'site' && row.outcome !== 'not_applicable');

const SCORED_SITE_RULES = policy.site_health.rule_catalog
  .filter((rule) => rule.scope === 'site' && membership(rule.rule_id).score_roles.length)
  .map((rule) => rule.rule_id);
/**
 * The crawl's applied site checks, with every scored site check the crawl never
 * evaluated (no root analysis, no site facts) as unknown: a missing crawler
 * verdict keeps measurement partial instead of silently dropping out.
 */
export function crawlSiteChecks(rows: RuleEvaluation[]) {
  const applied = appliedSiteChecks(rows);
  const seen = new Set(applied.map((row) => row.rule_id));
  return [
    ...applied,
    ...SCORED_SITE_RULES.filter((id) => !seen.has(id)).map((id) =>
      finalizeEvaluation(id, 'unknown', { reason: 'site_facts_unavailable' }),
    ),
  ];
}

const withSiteChecks = (rows: RuleEvaluation[], siteRows: RuleEvaluation[]) => [
  ...rows.filter((row) => row.scope === 'page'),
  ...appliedSiteChecks(siteRows),
];

/** One applicable check per rule; duplicates that disagree count as unknown. */
function applicableChecks(rows: RuleEvaluation[], role: string) {
  const byId = new Map<string, RuleEvaluation>();
  const conflicted = new Set<string>();
  for (const row of rows) {
    if (!row.score_roles.includes(role) || row.outcome === 'not_applicable') continue;
    const seen = byId.get(row.rule_id);
    if (!seen) byId.set(row.rule_id, row);
    else if (seen.outcome !== row.outcome) conflicted.add(row.rule_id);
  }
  return [...byId.values()].map((row) =>
    conflicted.has(row.rule_id) ? { ...row, outcome: 'unknown' } : row,
  );
}

function measurementState(determinate: number, expected: number) {
  if (!expected || !determinate) return 'not_measured';
  return determinate === expected ? 'measured' : 'limited_evidence';
}

/** Score resolved checks; every applicable check stays in coverage. */
function roleResult(rows: RuleEvaluation[]) {
  const expected = rows.length;
  const determinate = rows.filter((row) => DETERMINATE.has(row.outcome)).length;
  const passed = rows.filter((row) => row.outcome === 'satisfied').length;
  const state = measurementState(determinate, expected);
  if (!expected || !determinate)
    return { score: null, coverage: expected ? 0 : null, state, passed, determinate, expected };
  return {
    score: (100 * passed) / determinate,
    coverage: determinate / expected,
    state,
    passed,
    determinate,
    expected,
  };
}

function pillar(key: string, rows: RuleEvaluation[]) {
  const applicable = rows.filter((row) => row.readiness_dimension === key);
  const common = { key, label: LABELS[key], description: DESCRIPTIONS[key] };
  if (!applicable.length)
    return {
      ...common,
      dimension_applicability: 'not_applicable',
      dimension_measurement_state: 'not_measured',
      score: null,
      coverage: null,
      earned_points: 0,
      determinate_points: 0,
      expected_points: 0,
      determinate_checkpoint_ids: [] as string[],
      reason: 'no_applicable_checks',
      unresolved_count: 0,
    };
  const result = roleResult(applicable);
  return {
    ...common,
    dimension_applicability: 'applicable',
    dimension_measurement_state: result.state,
    score: result.score,
    coverage: result.coverage,
    earned_points: result.passed,
    determinate_points: result.determinate,
    expected_points: result.expected,
    determinate_checkpoint_ids: applicable
      .filter((row) => DETERMINATE.has(row.outcome))
      .map((row) => row.rule_id),
    reason: result.state === 'measured' ? '' : 'unresolved_checks',
    unresolved_count: result.expected - result.determinate,
  };
}
export type ReadinessDimension = ReturnType<typeof pillar>;

/** Weight scored pillars; incomplete checks are reported in coverage, not withheld. */
function weightedReadiness(dimensions: ReadinessDimension[]) {
  let applicableWeight = 0;
  let scoredWeight = 0;
  let weightedScore = 0;
  let weightedCoverage = 0;
  let state = 'measured';
  for (const row of dimensions) {
    if (row.dimension_applicability !== 'applicable') continue;
    const weight = WEIGHTS[row.key]!;
    applicableWeight += weight;
    weightedCoverage += (row.coverage ?? 0) * weight;
    if (row.dimension_measurement_state !== 'measured') state = 'limited_evidence';
    if (row.score !== null) {
      scoredWeight += weight;
      weightedScore += row.score * weight;
    }
  }
  const coverage = applicableWeight ? weightedCoverage / applicableWeight : null;
  if (!scoredWeight) return { score: null, coverage, state: 'not_measured' };
  return { score: weightedScore / scoredWeight, coverage, state };
}

export function readinessReason(
  score: number | null,
  state: string,
  anyApplicable: boolean,
  kind: string,
) {
  if (score !== null) return state === 'measured' ? '' : 'unresolved_checks';
  if (anyApplicable) return 'unresolved_checks';
  return kind === 'other' ? 'page_purpose_unresolved' : 'no_applicable_checks';
}

/** `siteRows` defaults to the page's own rows, which carry the site checks on the root analysis. */
export function scoreAnalysis(
  pageRows: RuleEvaluation[],
  pageKind: string,
  siteRows: RuleEvaluation[] = pageRows,
) {
  const rows = withSiteChecks(pageRows, siteRows);
  const kind = PAGE_KINDS.has(pageKind) ? pageKind : 'other';
  const web = roleResult(applicableChecks(rows, 'web_fundamentals'));
  const aeoRows = applicableChecks(rows, 'aeo_readiness');
  const dimensions = DIMENSIONS.map((key) => pillar(key, aeoRows));
  const aeo = weightedReadiness(dimensions);
  const indexable = rows.find(
    (row) => row.rule_id === 'technical.indexable' && DETERMINATE.has(row.outcome),
  );
  return {
    web_fundamentals_score: web.score,
    web_fundamentals_coverage: web.coverage,
    web_fundamentals_state: web.state,
    technical_earned_weight: web.passed,
    technical_determinate_weight: web.determinate,
    technical_expected_weight: web.expected,
    technical_critical_complete: web.determinate === web.expected,
    aeo_readiness_score: aeo.score,
    aeo_measurement_coverage: aeo.coverage,
    aeo_measurement_state: aeo.state,
    aeo_measurement_reason: readinessReason(
      aeo.score,
      aeo.state,
      dimensions.some((row) => row.dimension_applicability === 'applicable'),
      kind,
    ),
    expected_checkpoint_profile: rows
      .filter((row) => row.score_roles.length)
      .map((row) => ({
        check_id: row.rule_id,
        scope: row.scope,
        web_membership: row.score_roles.includes('web_fundamentals'),
        aeo_pillar: row.readiness_dimension || null,
        applicable: row.outcome !== 'not_applicable',
        outcome: row.outcome,
        reason: row.reason_code,
        weight: 1,
        rule_version: row.rule_version,
      })),
    readiness_dimensions: dimensions,
    main_content_indexable: indexable ? indexable.outcome === 'satisfied' : null,
  };
}
