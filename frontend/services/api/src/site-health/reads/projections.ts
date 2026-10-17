/**
 * Reads of a crawl's immutable projections: the Overview snapshot, the frozen
 * AEO Readiness diagnostic, the observed architecture and crawl changes.
 * Nothing is recomputed; presentation fields absent from an older frozen row
 * are filled from the config that owns them.
 */
import {
  aeoReadinessSchema,
  architectureSchema,
  changesPageSchema,
  changeSummarySchema,
  siteHealthOverviewSchema,
} from '@citeladder/contracts/site-health';
import { sql, type Selectable } from 'kysely';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record, strings } from '../../db/json.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import { ApiError, notFound } from '../../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { parseUuid } from '../../http/uuid.ts';
import { scalarText } from '../../text-order.ts';
import type { SiteChangeSnapshots } from '../../generated/db-schema.ts';
import { loadCrawl, loadProject, resolveUsableCrawl, type Crawl } from './crawl.ts';
import { pageRerunSql } from '../page-rerun.ts';
import { issueImpact, remediationRoute, ruleScoreRoles } from './rules.ts';

const reads = policy.site_health.reads;
const labels: Record<string, string> = reads.aeo_dimension_labels;
const descriptions: Record<string, string> = reads.aeo_dimension_descriptions;
const CONTENT_ADDRESSABLE = new Set(reads.content_addressable_check_ids);
const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
const OVERVIEW_UNAVAILABLE = 'Site Health Overview is not available';
const NO_COMPARABLE = {
  added_page_kinds: [],
  removed_page_kinds: [],
  previous_page_count_by_kind: {},
  current_page_count_by_kind: {},
};

function snapshotFor(db: Database, crawl: Crawl) {
  return new WorkspaceScope(crawl.workspace_id)
    .selectFrom(db, 'site_health_snapshots')
    .selectAll()
    .where('project_id', '=', crawl.project_id)
    .where('crawl_id', '=', crawl.id)
    .executeTakeFirst();
}

export async function overview(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
) {
  const crawl = await resolveUsableCrawl(db, workspaceId, projectId, crawlId);
  const snapshot = crawl ? await snapshotFor(db, crawl) : undefined;
  if (!crawl || !snapshot) throw new ApiError(404, OVERVIEW_UNAVAILABLE);
  const coverage = record(snapshot.coverage_evidence);
  const count = (key: string) =>
    typeof coverage[key] === 'number' ? Math.trunc(coverage[key]) : 0;
  return siteHealthOverviewSchema.parse({
    project_id: projectId,
    crawl_id: crawl.id,
    snapshot_id: snapshot.id,
    search_eligibility: snapshot.search_eligibility,
    eligibility_totals: record(snapshot.eligibility_totals),
    eligibility_reasons: list(snapshot.eligibility_reasons),
    web_fundamentals_score: snapshot.web_fundamentals_score,
    web_fundamentals_coverage: snapshot.web_fundamentals_coverage,
    web_fundamentals_state: snapshot.web_fundamentals_state,
    aeo_readiness_score: snapshot.aeo_readiness_score,
    aeo_measurement_coverage: snapshot.aeo_measurement_coverage,
    aeo_measurement_state: snapshot.aeo_measurement_state,
    classified_page_count: snapshot.classified_page_count,
    other_page_count: snapshot.other_page_count,
    classification_error_page_count: snapshot.classification_error_page_count,
    classification_expected_page_count: snapshot.classification_expected_page_count,
    classification_coverage: snapshot.classification_coverage,
    classification_state: snapshot.classification_state,
    classification_reason_groups: record(snapshot.classification_reason_groups),
    classification_formula_version: snapshot.classification_formula_version,
    classification_source_analysis_ids: strings(snapshot.classification_source_analysis_ids),
    classification_source_artifact_ids: strings(snapshot.classification_source_artifact_ids),
    classification_source_task_ids: strings(snapshot.classification_source_task_ids),
    scored_page_kind_set: strings(snapshot.scored_page_kind_set),
    scored_page_count_by_kind: record(snapshot.scored_page_count_by_kind),
    crawl_coverage: {
      state: snapshot.coverage_state,
      evidence: coverage,
      denominator_kind: 'selected_intended_public_urls',
    },
    audited_page_count: snapshot.analyzed_url_count,
    selected_page_count: snapshot.selected_url_count,
    status_counts: record(snapshot.status_counts),
    issue_count: snapshot.issue_count,
    technical_defect_count: snapshot.technical_defect_count,
    technical_defect_affected_page_count: snapshot.technical_defect_affected_page_count,
    aeo_readiness_gap_count: snapshot.aeo_readiness_gap_count,
    aeo_readiness_gap_affected_page_count: snapshot.aeo_readiness_gap_affected_page_count,
    severity_counts: record(snapshot.severity_counts),
    category_counts: record(snapshot.category_counts),
    measured_check_count: count('measured_check_count'),
    expected_check_count: count('expected_check_count'),
    aeo_dimensions: list(snapshot.readiness_dimensions)
      .map(record)
      .filter((row) => typeof row.key === 'string' && row.key in labels)
      .map((row) => {
        const key = row.key as string;
        return {
          ...row,
          label: row.label || labels[key],
          description: row.description || descriptions[key],
          unresolved_count: typeof row.unresolved_count === 'number' ? row.unresolved_count : 0,
        };
      }),
    top_issues: list(snapshot.top_issues)
      .slice(0, 5)
      .map(record)
      .filter((issue) => Object.keys(issue).length > 0)
      .map((issue) => {
        const ruleId = scalarText(issue.rule_id);
        const impact = issueImpact(
          ruleId,
          scalarText(issue.finding_class),
          scalarText(issue.severity),
        );
        return {
          score_roles: ruleScoreRoles(ruleId),
          impact_band: impact.band,
          impact_label: impact.label,
          ...issue,
        };
      }),
    web_fundamentals: snapshot.web_fundamentals ?? {
      state: 'not_measured',
      areas: [],
      field_data: {
        state: 'unavailable',
        reason: 'provider_not_configured',
        lcp: null,
        inp: null,
        cls: null,
      },
      source_analysis_ids: [],
      source_artifact_ids: [],
      source_evaluation_ids: [],
      limitations: [],
    },
    trend: snapshot.trend ?? {
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
      metric: 'aeo_readiness_score',
      series: [],
      cohort_composition: NO_COMPARABLE,
    },
    change_summary: snapshot.change_summary ?? {
      state: 'unavailable',
      reason: 'no_comparable_snapshot',
      metrics: [],
      cohort_composition: NO_COMPARABLE,
    },
  });
}

/** The frozen readiness diagnostic, with each check's current remediation actions. */
export async function aeoReadiness(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
) {
  const crawl = await resolveUsableCrawl(db, workspaceId, projectId, crawlId);
  const descriptor = crawl ? record((await snapshotFor(db, crawl))?.aeo_readiness_diagnostic) : {};
  if (!crawl || Object.keys(descriptor).length === 0) {
    const versions = reads.measurement_versions;
    return aeoReadinessSchema.parse({
      state: 'not_measured',
      crawl_id: crawl?.id ?? null,
      score: null,
      coverage: null,
      profile_version: versions.profile,
      schema_contract_version: versions.schema_contract,
      scoring_version: reads.scoring_version,
      presentation_version: versions.presentation,
      analyzer_version: '',
      source_analysis_ids: [],
      analysis_count: 0,
      affected_page_count: 0,
      dimensions: [],
      limitations: ['AEO Readiness appears after persisted page analysis.'],
    });
  }
  const action = (check: unknown) => {
    const row = record(check);
    const ruleId = String(row.rule_id);
    return {
      ...row,
      content_addressable: CONTENT_ADDRESSABLE.has(ruleId),
      remediation_route: remediationRoute(ruleId),
    };
  };
  return aeoReadinessSchema.parse({
    ...descriptor,
    dimensions: list(descriptor.dimensions).map((raw) => {
      const dimension = record(raw);
      return {
        ...dimension,
        checks: list(dimension.checks).map(action),
        evidence_pages: list(dimension.evidence_pages).map((page) => ({
          ...record(page),
          failed_checks: list(record(page).failed_checks).map(action),
        })),
      };
    }),
  });
}

function unavailableArchitecture(reason: string, crawlId: string | null = null) {
  return architectureSchema.parse({
    state: 'unavailable',
    crawl_id: crawlId,
    coverage_state: 'unknown',
    coverage_reasons: [],
    page_count: 0,
    page_kinds: [],
    nodes: [],
    internal_linking: {
      internal_link_count: 0,
      content_link_count: 0,
      pages_with_incoming_count: 0,
      pages_with_incoming_percentage: null,
      orphan_page_count: null,
      orphan_pages: [],
    },
    structure_depth: { measured_page_count: 0, unmeasured_page_count: 0, buckets: [] },
    architecture_formula_version: policy.site_health.architecture.formula_version,
    limitations: [reason],
  });
}

/** The crawl's newest persisted architecture model, whatever formula version wrote it. */
export async function architecture(
  db: Database,
  workspaceId: string,
  projectId: string,
  crawlId: string | null,
) {
  const crawl = await resolveUsableCrawl(db, workspaceId, projectId, crawlId);
  if (!crawl)
    return unavailableArchitecture('No usable persisted crawl has an observed architecture.');
  const workspace = new WorkspaceScope(workspaceId);
  const [model, snapshot] = await Promise.all([
    workspace
      .selectFrom(db, 'site_observed_architectures')
      .selectAll()
      .where('project_id', '=', crawl.project_id)
      .where('crawl_id', '=', crawl.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst(),
    snapshotFor(db, crawl),
  ]);
  if (!model)
    return unavailableArchitecture(
      'This crawl has no observed architecture yet — it is derived after the crawl finishes.',
      crawl.id,
    );
  const coverageState = model.coverage_state || 'unknown';
  const linking = record(model.internal_linking);
  // When every observed page has an inbound link the orphan count is zero,
  // however the stored row spelled it.
  let orphans = typeof linking.orphan_page_count === 'number' ? linking.orphan_page_count : null;
  if (
    orphans === null &&
    model.page_count > 0 &&
    linking.pages_with_incoming_count === model.page_count
  )
    orphans = 0;
  return architectureSchema.parse({
    state: 'available',
    crawl_id: crawl.id,
    coverage_state: coverageState,
    coverage_reasons: strings(record(snapshot?.coverage_evidence).reasons).filter(Boolean),
    page_count: model.page_count,
    page_kinds: list(model.page_kinds)
      .map(record)
      .map((row) => ({
        page_kind: scalarText(row.page_kind) || 'other',
        page_count: typeof row.page_count === 'number' ? row.page_count : 0,
        median_depth: row.median_depth ?? null,
        indexable_count: typeof row.indexable_count === 'number' ? row.indexable_count : 0,
        duplicate_metadata_count:
          typeof row.duplicate_metadata_count === 'number' ? row.duplicate_metadata_count : 0,
        orphan_count: row.orphan_count ?? null,
      })),
    nodes: list(model.hierarchy)
      .map(record)
      .map((row) => ({
        site_url_id: scalarText(row.site_url_id),
        url: scalarText(row.url),
        title: scalarText(row.title),
        page_kind: scalarText(row.page_kind),
        parent_site_url_id: scalarText(row.parent_site_url_id) || null,
        parent_source: scalarText(row.parent_source) || 'unknown',
        depth_from_home: row.depth_from_home ?? null,
      })),
    internal_linking: { orphan_pages: [], ...linking, orphan_page_count: orphans },
    structure_depth: record(model.structure_depth),
    architecture_formula_version: model.architecture_formula_version,
    limitations: [],
  });
}

type ChangeSnapshot = Selectable<SiteChangeSnapshots>;

/** The newest change snapshot, or the exact pair's when both crawls are named. */
async function changeSnapshot(
  db: Database,
  workspaceId: string,
  projectId: string,
  pair: { a: string | null; b: string | null },
): Promise<ChangeSnapshot | undefined> {
  await loadProject(db, workspaceId, projectId);
  if ((pair.a === null) !== (pair.b === null))
    throw new ApiError(422, 'crawl_a_id and crawl_b_id must be supplied together', {
      code: 'validation_error',
    });
  let query = new WorkspaceScope(workspaceId)
    .selectFrom(db, 'site_change_snapshots')
    .selectAll()
    .where('project_id', '=', projectId)
    // Snapshots written for page reruns before they stopped writing any.
    .where('crawl_b_id', 'not in', (eb) =>
      eb
        .selectFrom('site_crawls')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('project_id', '=', projectId)
        .where(pageRerunSql),
    );
  if (pair.a !== null && pair.b !== null) {
    const crawls = await Promise.all([pair.a, pair.b].map((id) => loadCrawl(db, workspaceId, id)));
    if (crawls.some((crawl) => crawl.project_id !== projectId)) throw notFound('Crawl');
    query = query.where('crawl_a_id', '=', pair.a).where('crawl_b_id', '=', pair.b);
  }
  return query.orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
}

function changeSummary(snapshot: ChangeSnapshot | undefined) {
  if (snapshot === undefined)
    return {
      state: policy.site_health.change_intel.state_unavailable,
      reason_code: 'no_persisted_change_snapshot',
      snapshot_id: null,
      crawl_a_id: null,
      crawl_b_id: null,
      complete_pair: false,
      analyzer_version: policy.site_health.change_intel.analyzer_version,
      page_analyzer_version: '',
      extractor_version: '',
      source_analysis_ids: [],
      coverage: {},
      summary: {},
      limitations: ['No persisted crawl comparison is available.'],
      created_at: null,
    };
  return {
    state: snapshot.state,
    reason_code: snapshot.reason_code,
    snapshot_id: snapshot.id,
    crawl_a_id: snapshot.crawl_a_id,
    crawl_b_id: snapshot.crawl_b_id,
    complete_pair: snapshot.complete_pair,
    analyzer_version: snapshot.analyzer_version,
    page_analyzer_version: snapshot.page_analyzer_version,
    extractor_version: snapshot.extractor_version,
    source_analysis_ids: strings(snapshot.source_analysis_ids),
    coverage: record(snapshot.coverage),
    summary: record(snapshot.summary),
    limitations: strings(snapshot.limitations),
    created_at: snapshot.created_at.toISOString(),
  };
}

export async function changesSummary(
  db: Database,
  workspaceId: string,
  projectId: string,
  pair: { a: string | null; b: string | null },
) {
  return changeSummarySchema.parse(
    changeSummary(await changeSnapshot(db, workspaceId, projectId, pair)),
  );
}

export async function changes(
  db: Database,
  workspaceId: string,
  projectId: string,
  pair: { a: string | null; b: string | null },
  paging: { limit: number; cursor: string | null },
) {
  const snapshot = await changeSnapshot(db, workspaceId, projectId, pair);
  const summary = changeSummary(snapshot);
  if (snapshot === undefined)
    return changesPageSchema.parse({ ...summary, items: [], next_cursor: null });
  const fingerprint = { snapshot_id: snapshot.id };
  let after = sql``;
  if (paging.cursor) {
    const [url, field, raw, ...rest] = decodeKeysetCursor(
      paging.cursor,
      'site-change-observations',
      fingerprint,
    );
    const id = parseUuid(raw);
    if (url === undefined || field === undefined || id === null || rest.length > 0)
      throw new InvalidCursorError('invalid cursor');
    after = sql`and (o.normalized_url, o.field, o.id) > (${url}, ${field}, ${id}::uuid)`;
  }
  const { rows } = await sql<{
    id: string;
    site_url_id: string;
    normalized_url: string;
    field: string;
    change_class: string;
    before_value: unknown;
    after_value: unknown;
    source_analysis_a_id: string | null;
    source_analysis_b_id: string | null;
    source_artifact_a_id: string | null;
    source_artifact_b_id: string | null;
    source_evaluation_a_id: string | null;
    source_evaluation_b_id: string | null;
    expected: boolean;
    implementation_event_id: string | null;
    created_at: Date;
  }>`
    select o.* from site_change_observations o
    where o.workspace_id = ${workspaceId} and o.snapshot_id = ${snapshot.id} ${after}
    order by o.normalized_url, o.field, o.id limit ${paging.limit + 1}`.execute(db);
  const items = rows.slice(0, paging.limit);
  const last = items.at(-1);
  return changesPageSchema.parse({
    ...summary,
    items: items.map((row) => ({ ...row, created_at: row.created_at.toISOString() })),
    next_cursor:
      rows.length > paging.limit && last
        ? encodeKeysetCursor('site-change-observations', fingerprint, [
            last.normalized_url,
            last.field,
            last.id,
          ])
        : null,
  });
}
