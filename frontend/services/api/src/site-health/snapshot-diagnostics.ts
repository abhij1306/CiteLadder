/** Persist diagnostic panels with the same frozen evaluation and page sources as scores. */
import { policy } from '../config.ts';
import { record } from '../db/json.ts';
import type { MeasurementProjection } from './score-summary.ts';
import type { Crawl } from './task-fence.ts';
import { compareText } from '../text-order.ts';
import { firstOf } from '../lists.ts';

const reads = policy.site_health.reads;
const catalog = new Map(policy.site_health.rule_catalog.map((row) => [row.rule_id, row]));
type Evaluation = MeasurementProjection['evaluations'][number];
const failing = (row: Evaluation) => reads.failing_outcomes.includes(row.outcome);
/** An entity check's own failure count: a finite number or a digit string, otherwise none. */
function reportedFailures(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  return typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0;
}
/** Failing pages, the site once, or each entity check's own reported failures. */
function failingEntities(scope: string, failures: Evaluation[]) {
  if (scope === 'page') return new Set(failures.map((row) => row.analysis_id)).size;
  if (scope === 'site') return Number(failures.length > 0);
  return failures.reduce(
    (sum, row) => sum + Math.max(1, reportedFailures(record(row.evidence).failure_count)),
    0,
  );
}
function measurementState(determinate: number, applicable: number) {
  if (!applicable) return 'not_measured';
  return determinate === applicable ? 'measured' : 'limited_evidence';
}
const counts = (rows: Evaluation[]) =>
  Object.fromEntries(
    ['satisfied', 'partial', 'missing', 'unknown', 'not_applicable', 'error'].map((outcome) => [
      `${outcome}_count`,
      rows.filter((row) => row.outcome === outcome).length,
    ]),
  );

export function readinessDiagnostic(crawl: Crawl, projection: MeasurementProjection) {
  const logical = new Map(
    projection.rows.flatMap((row) =>
      (row.source_evaluation_ids ?? []).map((id) => [id, row.id] as const),
    ),
  );
  const all = projection.evaluations
    .filter(
      (row) =>
        catalog.has(row.rule_id) &&
        row.readiness_dimension &&
        row.score_roles?.includes('aeo_readiness'),
    )
    .map((row) => ({ ...row, analysis_id: logical.get(row.id) ?? row.analysis_id }));
  const rows = all.slice(0, reads.aeo_max_evaluations);
  const pages = new Map(projection.rows.map((row) => [row.id, row]));
  const dimensions = projection.aggregate.readiness_dimensions.map((dimension) => {
    const relevant = rows.filter((row) => row.readiness_dimension === dimension.key);
    const pageRows = relevant.filter((row) => row.scope === 'page');
    const byPage = new Map<string, Evaluation[]>();
    for (const row of pageRows.filter(failing)) {
      if (!pages.has(row.analysis_id)) continue;
      const group = byPage.get(row.analysis_id) ?? [];
      group.push(row);
      byPage.set(row.analysis_id, group);
    }
    const evidencePages = [...byPage]
      .sort(
        (a, b) =>
          b[1].length - a[1].length ||
          compareText(pages.get(a[0])!.normalized_url, pages.get(b[0])!.normalized_url) ||
          compareText(a[0], b[0]),
      )
      .slice(0, reads.aeo_max_evidence_pages)
      .map(([id, failures]) => ({
        site_url_id: pages.get(id)!.site_url_id,
        source_analysis_id: id,
        normalized_url: pages.get(id)!.normalized_url,
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
      }));
    const checkpointIds = [...new Set(relevant.map((row) => row.rule_id))].toSorted(compareText);
    const failurePages = new Set(pageRows.filter(failing).map((row) => row.analysis_id)).size;
    return {
      ...dimension,
      ...counts(relevant),
      checkpoint_ids: checkpointIds,
      checked_page_count: new Set(
        pageRows
          .filter((row) => ['satisfied', 'partial', 'missing'].includes(row.outcome))
          .map((row) => row.analysis_id),
      ).size,
      failing_page_count: failurePages,
      evidence_pages: evidencePages,
      evidence_truncated: failurePages > evidencePages.length,
      checks: checkpointIds.map((id) => {
        const group = relevant.filter((row) => row.rule_id === id);
        const first = firstOf(group, `an evaluation of checkpoint ${id}`);
        const scope = first.scope;
        const failures = group.filter(failing);
        const rule = catalog.get(id)!;
        const failureCount = failingEntities(scope, failures);
        return {
          rule_id: id,
          scope,
          title: rule.display_label,
          remediation: rule.remediation,
          ...counts(group),
          failing_entity_count: failureCount,
          aeo_pillar: first.readiness_dimension,
          content_addressable: rule.content_addressable,
          remediation_route: rule.remediation_route,
        };
      }),
    };
  });
  const aggregate = projection.aggregate;
  const limitations: string[] = [];
  if (all.length > rows.length)
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
    source_analysis_ids: [...pages.keys()],
    analysis_count: pages.size,
    affected_page_count: new Set(
      rows.filter((row) => row.scope === 'page' && failing(row)).map((row) => row.analysis_id),
    ).size,
    dimensions,
    limitations,
  };
}

export function webDiagnostic(projection: MeasurementProjection) {
  const sources: string[] = [];
  const areas = reads.web_fundamentals_areas.map((area) => {
    const rows = projection.evaluations.filter(
      (row) => catalog.get(row.rule_id)?.web_fundamentals_area === area,
    );
    sources.push(...rows.map((row) => row.id));
    const applicable = rows.filter((row) => row.outcome !== 'not_applicable');
    const determinate = applicable.filter((row) => ['satisfied', 'missing'].includes(row.outcome));
    const findings = new Map<
      string,
      {
        rule_id: string;
        title: string;
        remediation: string;
        affected_pages: number;
        source_evaluation_ids: string[];
      }
    >();
    for (const row of rows.filter((row) => row.outcome === 'missing')) {
      const rule = catalog.get(row.rule_id)!;
      const finding = findings.get(row.rule_id) ?? {
        rule_id: row.rule_id,
        title: rule.display_label,
        remediation: rule.remediation,
        affected_pages: 0,
        source_evaluation_ids: [],
      };
      finding.affected_pages++;
      finding.source_evaluation_ids.push(row.id);
      findings.set(row.rule_id, finding);
    }
    return {
      key: area,
      state: measurementState(determinate.length, applicable.length),
      coverage: applicable.length
        ? Math.round((determinate.length / applicable.length) * 10000) / 10000
        : null,
      passed_count: rows.filter((row) => row.outcome === 'satisfied').length,
      missing_count: rows.filter((row) => row.outcome === 'missing').length,
      unknown_count: rows.filter((row) => row.outcome === 'unknown').length,
      unavailable_count: rows.filter((row) => row.outcome === 'unavailable').length,
      unavailable_checks: [],
      top_findings: [...findings.values()].slice(0, 5),
    };
  });
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
    source_analysis_ids: projection.rows.map((row) => row.id),
    source_artifact_ids: projection.rows.map((row) => row.artifact_id),
    source_evaluation_ids: sources,
    limitations: [],
  };
}
