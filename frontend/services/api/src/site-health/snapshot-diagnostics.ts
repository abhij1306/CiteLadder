import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import type { ProjectionEvaluation } from './score-summary.ts';
import type { Crawl } from './site-task.ts';
import { compareText } from '../text-order.ts';

const reads = policy.site_health.reads;
const catalog = new Map(policy.site_health.rule_catalog.map((row) => [row.rule_id, row]));
type Evaluation = ProjectionEvaluation;
const OUTCOMES = ['satisfied', 'partial', 'missing', 'unknown', 'not_applicable', 'error'];
const failing = (row: Evaluation) => reads.failing_outcomes.includes(row.outcome);
function reportedFailures(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0;
}
function measurementState(determinate: number, applicable: number) {
  if (!applicable) return 'not_measured';
  return determinate === applicable ? 'measured' : 'limited_evidence';
}
const emptyCounts = () => Object.fromEntries(OUTCOMES.map((outcome) => [`${outcome}_count`, 0]));
function count(counts: Record<string, number>, outcome: string) {
  const key = `${outcome}_count`;
  if (key in counts) counts[key]! += 1;
}

export type DiagnosticPage = {
  id: string;
  site_url_id: string;
  normalized_url: string;
  evaluations: Evaluation[];
};

type EvidencePage = { page: DiagnosticPage; failures: Evaluation[] };
type Check = {
  scope: string;
  pillar: string;
  counts: Record<string, number>;
  failures: number;
  failingPages: number;
  failed: boolean;
};

class DimensionFold {
  counts = emptyCounts();
  checks = new Map<string, Check>();
  checkedPages = 0;
  failingPages = 0;
  evidence: EvidencePage[] = [];
  private countCheck(row: Evaluation) {
    const check = this.checks.get(row.rule_id) ?? {
      scope: row.scope,
      pillar: row.readiness_dimension ?? '',
      counts: emptyCounts(),
      failures: 0,
      failingPages: 0,
      failed: false,
    };
    this.checks.set(row.rule_id, check);
    count(check.counts, row.outcome);
    if (!failing(row)) return false;
    check.failed = true;
    if (check.scope === 'page') return true;
    if (check.scope !== 'site')
      check.failures += Math.max(1, reportedFailures(record(row.evidence).failure_count));
    return false;
  }
  addPage(page: DiagnosticPage, rows: Evaluation[]) {
    const failures: Evaluation[] = [];
    let checked = false;
    const failedRules = new Set<string>();
    for (const row of rows) {
      count(this.counts, row.outcome);
      if (this.countCheck(row)) failedRules.add(row.rule_id);
      if (row.scope !== 'page') continue;
      if (['satisfied', 'partial', 'missing'].includes(row.outcome)) checked = true;
      if (failing(row)) failures.push(row);
    }
    for (const rule of failedRules) this.checks.get(rule)!.failingPages++;
    if (checked) this.checkedPages++;
    if (!failures.length) return;
    this.failingPages++;
    this.evidence.push({ page, failures });
    this.evidence.sort(
      (a, b) =>
        b.failures.length - a.failures.length ||
        compareText(a.page.normalized_url, b.page.normalized_url) ||
        compareText(a.page.id, b.page.id),
    );
    this.evidence.length = Math.min(this.evidence.length, reads.aeo_max_evidence_pages);
  }
}

export class ReadinessDiagnosticFold {
  private readonly dimensions = new Map<string, DimensionFold>();
  private total = 0;
  private taken = 0;
  private affected = 0;
  private analyses = 0;
  addPage(page: DiagnosticPage) {
    this.analyses++;
    const byDimension = new Map<string, Evaluation[]>();
    let affected = false;
    for (const row of page.evaluations) {
      if (!catalog.has(row.rule_id) || !row.readiness_dimension) continue;
      if (!row.score_roles?.includes('aeo_readiness')) continue;
      this.total++;
      if (this.taken >= reads.aeo_max_evaluations) continue;
      this.taken++;
      const group = byDimension.get(row.readiness_dimension) ?? [];
      group.push(row);
      byDimension.set(row.readiness_dimension, group);
      if (row.scope === 'page' && failing(row)) affected = true;
    }
    if (affected) this.affected++;
    for (const [key, rows] of byDimension) {
      const fold = this.dimensions.get(key) ?? new DimensionFold();
      fold.addPage(page, rows);
      this.dimensions.set(key, fold);
    }
  }
  result(
    crawl: Crawl,
    aggregate: {
      aeo_measurement_state: string;
      aeo_readiness_score: number | null;
      aeo_measurement_coverage: number | null;
      readiness_dimensions: { key: string }[];
    },
  ) {
    const dimensions = aggregate.readiness_dimensions.map((dimension) => {
      const fold = this.dimensions.get(dimension.key) ?? new DimensionFold();
      const checkpointIds = [...fold.checks.keys()].toSorted(compareText);
      return {
        ...dimension,
        ...fold.counts,
        checkpoint_ids: checkpointIds,
        checked_page_count: fold.checkedPages,
        failing_page_count: fold.failingPages,
        evidence_pages: fold.evidence.map(({ page, failures }) => ({
          site_url_id: page.site_url_id,
          source_analysis_id: page.id,
          normalized_url: page.normalized_url,
          failed_checks: failures
            .toSorted((a, b) => compareText(a.rule_id, b.rule_id))
            .map((row) => {
              const rule = catalog.get(row.rule_id)!;
              return {
                rule_id: row.rule_id,
                title: rule.display_label,
                observed_evidence: record(row.evidence),
                expected_capability: rule.description,
                remediation: rule.remediation,
                content_addressable: rule.content_addressable,
                remediation_route: rule.remediation_route,
              };
            }),
        })),
        evidence_truncated: fold.failingPages > fold.evidence.length,
        checks: checkpointIds.map((id) => {
          const check = fold.checks.get(id)!;
          const rule = catalog.get(id)!;
          let failureCount = check.failures;
          if (check.scope === 'page') failureCount = check.failingPages;
          if (check.scope === 'site') failureCount = Number(check.failed);
          return {
            rule_id: id,
            scope: check.scope,
            title: rule.display_label,
            remediation: rule.remediation,
            ...check.counts,
            failing_entity_count: failureCount,
            aeo_pillar: check.pillar,
            content_addressable: rule.content_addressable,
            remediation_route: rule.remediation_route,
          };
        }),
      };
    });
    const limitations: string[] = [];
    if (this.total > this.taken)
      limitations.push(
        `Readiness diagnostic counts and evidence are truncated at ${reads.aeo_max_evaluations} evaluations.`,
      );
    return {
      state: aggregate.aeo_measurement_state,
      crawl_id: crawl.id,
      score: aggregate.aeo_readiness_score,
      coverage: aggregate.aeo_measurement_coverage,
      profile_version: reads.measurement_versions.profile,
      schema_contract_version: reads.measurement_versions.schema_contract,
      scoring_version: crawl.scoring_version || reads.scoring_version,
      presentation_version: reads.measurement_versions.presentation,
      analyzer_version: crawl.analyzer_version || policy.site_health.versions.analyzer,
      analysis_count: this.analyses,
      affected_page_count: this.affected,
      dimensions,
      limitations,
    };
  }
}

type Finding = { rule_id: string; title: string; remediation: string; affected_pages: number };
type Area = {
  rows: number;
  applicable: number;
  determinate: number;
  passed: number;
  missing: number;
  unknown: number;
  unavailable: number;
  findings: Map<string, Finding>;
};

export class WebDiagnosticFold {
  private readonly areas = new Map<string, Area>(
    reads.web_fundamentals_areas.map((area) => [
      area,
      {
        rows: 0,
        applicable: 0,
        determinate: 0,
        passed: 0,
        missing: 0,
        unknown: 0,
        unavailable: 0,
        findings: new Map(),
      },
    ]),
  );
  addEvaluations(rows: Evaluation[]) {
    for (const row of rows) {
      const area = this.areas.get(catalog.get(row.rule_id)?.web_fundamentals_area ?? '');
      if (!area) continue;
      area.rows++;
      if (row.outcome !== 'not_applicable') area.applicable++;
      if (row.outcome === 'satisfied' || row.outcome === 'missing') area.determinate++;
      if (row.outcome === 'satisfied') area.passed++;
      if (row.outcome === 'unknown') area.unknown++;
      if (row.outcome === 'unavailable') area.unavailable++;
      if (row.outcome !== 'missing') continue;
      area.missing++;
      const rule = catalog.get(row.rule_id)!;
      const finding = area.findings.get(row.rule_id) ?? {
        rule_id: row.rule_id,
        title: rule.display_label,
        remediation: rule.remediation,
        affected_pages: 0,
      };
      finding.affected_pages++;
      area.findings.set(row.rule_id, finding);
    }
  }
  result(sourceArtifactIds: string[]) {
    const areas = [...this.areas].map(([key, area]) => ({
      key,
      state: measurementState(area.determinate, area.applicable),
      coverage: area.applicable
        ? Math.round((area.determinate / area.applicable) * 10000) / 10000
        : null,
      passed_count: area.passed,
      missing_count: area.missing,
      unknown_count: area.unknown,
      unavailable_count: area.unavailable,
      unavailable_checks: [],
      top_findings: [...area.findings.values()].slice(0, 5),
    }));
    const measured = areas.filter((area) => area.state !== 'not_measured');
    return {
      state: measurementState(
        measured.filter((area) => area.state === 'measured').length,
        measured.length,
      ),
      areas,
      field_data: {
        state: 'unavailable',
        reason: 'provider_not_configured',
        lcp: null,
        inp: null,
        cls: null,
      },
      source_artifact_ids: sourceArtifactIds,
      limitations: [],
    };
  }
}
