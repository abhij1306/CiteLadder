import { sql } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { MeasurementFold } from './analysis/measurement-aggregation.ts';
import { crawlSiteChecks } from './analysis/scoring.ts';
import { persistedEvaluation } from './terminal-analysis.ts';
import { pageAuditsSql } from './reads/crawl.ts';
import { EligibilityFold } from './snapshot-eligibility.ts';
import { ReadinessDiagnosticFold, WebDiagnosticFold } from './snapshot-diagnostics.ts';
import type { Crawl } from './site-task.ts';
import { compareText, scalarText } from '../text-order.ts';

const batchSize = () => policy.site_health.crawl.finalize.projection_pages;

export function classificationState(classified: number, expected: number) {
  if (!expected) return 'not_measured';
  return classified === expected ? 'complete' : 'partial';
}

/**
 * Publishing from the latest audits serializes per profile. A crawl's own
 * provisional summary takes no profile lock: it reads only its analyses.
 */
export async function lockProfile(db: Database, crawl: Crawl) {
  await db
    .selectFrom('site_health_profiles')
    .select('id')
    .where('id', '=', crawl.profile_id)
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

function evaluationsById(db: Database, crawl: Crawl, ids: string[], siteOnly = false) {
  return db
    .selectFrom('site_rule_evaluations')
    .select([
      'id',
      'analysis_id',
      'rule_id',
      'rule_version',
      'dimension',
      'category',
      'severity',
      'finding_class',
      'scope',
      'weight',
      'outcome',
      'display_applicability',
      'score_applicability',
      'reason_code',
      'score_roles',
      'readiness_dimension',
      'readiness_weight',
      sql<unknown>`case when 'aeo_readiness' = any(score_roles) then evidence end`.as('evidence'),
    ])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('id', '=', sql<string>`any(${ids}::uuid[])`)
    .$if(siteOnly, (query) => query.where('scope', '=', 'site'))
    .orderBy('id')
    .execute();
}
export type ProjectionEvaluation = Awaited<ReturnType<typeof evaluationsById>>[number];

async function selectedAfter(
  db: Database,
  crawl: Crawl,
  { after, size }: { after: string | null; size: number },
) {
  const rows = await db
    .selectFrom('monitored_site_urls')
    .select('site_url_id')
    .where('workspace_id', '=', crawl.workspace_id)
    .where('project_id', '=', crawl.project_id)
    .where('active', '=', true)
    .$if(after !== null, (query) => query.where('site_url_id', '>', after ?? ''))
    .orderBy('site_url_id')
    .limit(size)
    .execute();
  return rows.map((row) => row.site_url_id);
}

function batchAnalyses(db: Database, crawl: Crawl, ids: string[]) {
  const batch = sql`any(${ids}::uuid[])`;
  return db
    .selectFrom('site_page_analyses as p')
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'p.site_url_id')
        .onRef('u.workspace_id', '=', 'p.workspace_id')
        .onRef('u.project_id', '=', 'p.project_id'),
    )
    .select([
      'p.id',
      'p.site_url_id',
      'p.crawl_id',
      'p.artifact_id',
      'p.page_kind',
      'p.source_evaluation_ids',
      'u.normalized_url',
      sql<string | null>`p.page_kind_evidence ->> 'other_reason'`.as('other_reason'),
    ])
    .distinctOn('p.site_url_id')
    .where('p.workspace_id', '=', crawl.workspace_id)
    .where('p.project_id', '=', crawl.project_id)
    .where(
      'p.id',
      'in',
      sql<string>`(select v.analysis_id from (${pageAuditsSql(crawl, batch)}) v)`,
    )
    .where('p.status', '=', 'completed')
    .where('p.site_url_id', '=', sql<string>`${batch}`)
    .orderBy('p.site_url_id')
    .orderBy('p.created_at', 'desc')
    .orderBy('p.id', 'desc')
    .execute();
}
type Analysis = Awaited<ReturnType<typeof batchAnalyses>>[number];

async function batchTasks(db: Database, crawl: Crawl, ids: string[], rows: Analysis[]) {
  const auditedBy = new Map(rows.map((row) => [row.site_url_id, row.crawl_id]));
  const crawlIds = [...new Set([crawl.id, ...auditedBy.values()])];
  const candidates = await db
    .selectFrom('site_crawl_tasks')
    .select([
      'id',
      'crawl_id',
      'site_url_id',
      'status',
      'error_code',
      'result_artifact_id',
      'classification_expected',
    ])
    .distinctOn(['crawl_id', 'site_url_id'])
    .where('workspace_id', '=', crawl.workspace_id)
    .where('crawl_id', '=', sql<string>`any(${crawlIds}::uuid[])`)
    .where('task_kind', 'in', ['analyze', 'discover'])
    .where('site_url_id', '=', sql<string>`any(${ids}::uuid[])`)
    .orderBy('crawl_id')
    .orderBy('site_url_id')
    .orderBy(sql`task_kind = 'analyze'`, 'desc')
    .orderBy('generation', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return candidates
    .filter((row) => row.crawl_id === (auditedBy.get(row.site_url_id ?? '') ?? crawl.id))
    .sort((a, b) => compareText(a.site_url_id ?? '', b.site_url_id ?? ''));
}
export type ProjectionTask = Awaited<ReturnType<typeof batchTasks>>[number];

async function eachBatch(
  db: Database,
  crawl: Crawl,
  visit: (ids: string[], rows: Analysis[]) => Promise<void>,
) {
  const size = batchSize();
  let after: string | null = null;
  for (;;) {
    const ids: string[] = await selectedAfter(db, crawl, { after, size }); // NOSONAR -- Keyset batches, in order.
    if (!ids.length) return;
    await visit(ids, await batchAnalyses(db, crawl, ids)); // NOSONAR -- Keyset batches, in order.
    const last = ids.at(-1);
    if (!last || ids.length < size) return;
    after = last;
  }
}

async function sharedSiteEvaluations(db: Database, crawl: Crawl) {
  const shared = new Map<string, ProjectionEvaluation>();
  await eachBatch(db, crawl, async (_ids, rows) => {
    const named = [...new Set(rows.flatMap((row) => row.source_evaluation_ids ?? []))];
    for (const row of await evaluationsById(db, crawl, named, true)) shared.set(row.id, row);
  });
  return [...shared.values()].sort((a, b) => compareText(a.id, b.id));
}

const TASK_ENDED = new Set(['succeeded', 'failed', 'cancelled']);

class ClassificationFold {
  kinds: Record<string, number> = {};
  reasons: Record<string, number> = {};
  analysisIds: string[] = [];
  artifactIds = new Set<string>();
  taskIds: string[] = [];
  classified = 0;
  other = 0;
  errors = 0;
  add(rows: Analysis[], tasks: ProjectionTask[]) {
    const expected = tasks.filter((row) => row.classification_expected);
    const expectedByUrl = new Map(expected.map((row) => [row.site_url_id, row]));
    const completed = new Set<string>();
    for (const row of rows) {
      if (expectedByUrl.get(row.site_url_id)?.result_artifact_id !== row.artifact_id) continue;
      completed.add(row.site_url_id);
      this.addAnalysis(row);
    }
    for (const task of expected) {
      this.taskIds.push(task.id);
      if (completed.has(task.site_url_id!) || !TASK_ENDED.has(task.status)) continue;
      this.errors++;
      this.addReason(task.error_code || 'classification_failed');
      if (task.result_artifact_id) this.artifactIds.add(task.result_artifact_id);
    }
  }
  private addAnalysis(row: Analysis) {
    this.analysisIds.push(row.id);
    this.artifactIds.add(row.artifact_id);
    this.kinds[row.page_kind] = (this.kinds[row.page_kind] ?? 0) + 1;
    if (row.page_kind !== 'other') {
      this.classified++;
      return;
    }
    this.other++;
    this.addReason(scalarText(row.other_reason) || 'page_purpose_unresolved');
  }
  private addReason(reason: string) {
    this.reasons[reason] = (this.reasons[reason] ?? 0) + 1;
  }
  result() {
    const expected = this.taskIds.length;
    return {
      classified_page_count: this.classified,
      other_page_count: this.other,
      classification_error_page_count: this.errors,
      classification_expected_page_count: expected,
      classification_coverage: expected
        ? Math.round((this.classified / expected) * 10000) / 10000
        : null,
      classification_state: classificationState(this.classified, expected),
      classification_reason_groups: this.reasons,
      classification_formula_version: policy.site_health.reads.classification_formula_version,
      classification_source_analysis_ids: this.analysisIds.toSorted(compareText),
      classification_source_artifact_ids: [...this.artifactIds].toSorted(compareText),
      classification_source_task_ids: this.taskIds.toSorted(compareText),
      scored_page_kind_set: Object.keys(this.kinds).toSorted(compareText),
      scored_page_count_by_kind: this.kinds,
    };
  }
}

function addCheckCounts(
  counts: { measured: number; expected: number },
  rows: ProjectionEvaluation[],
) {
  for (const row of rows) {
    if (!row.score_roles?.length || row.outcome === 'not_applicable') continue;
    counts.expected++;
    if (row.outcome === 'satisfied' || row.outcome === 'missing') counts.measured++;
  }
}

export async function measurementProjection(db: Database, crawl: Crawl) {
  const shared = await sharedSiteEvaluations(db, crawl);
  const measurement = new MeasurementFold(crawlSiteChecks(shared.map(persistedEvaluation)));
  const crawler = shared.findLast((row) => row.rule_id === 'search.crawler_access');
  const eligibility = new EligibilityFold(crawler);
  const classification = new ClassificationFold();
  const readiness = new ReadinessDiagnosticFold();
  const web = new WebDiagnosticFold();
  const checks = { measured: 0, expected: 0 };
  const seenShared = new Set<string>();
  const analysisIds: string[] = [];
  const artifactIds: string[] = [];
  let selected = 0;
  await eachBatch(db, crawl, async (ids, rows) => {
    selected += ids.length;
    const named = [...new Set(rows.flatMap((row) => row.source_evaluation_ids ?? []))];
    const byId = new Map(
      (await evaluationsById(db, crawl, named)).map((row) => [row.id, row] as const),
    );
    const own = new Map<string, ProjectionEvaluation[]>();
    for (const row of rows) {
      analysisIds.push(row.id);
      artifactIds.push(row.artifact_id);
      const evaluations = (row.source_evaluation_ids ?? []).flatMap((id) => {
        const evaluation = byId.get(id);
        return evaluation ? [evaluation] : [];
      });
      own.set(row.site_url_id, evaluations);
      measurement.add({
        page_kind: row.page_kind,
        evaluations: evaluations.map(persistedEvaluation),
      });
      const counted = evaluations.filter((evaluation) => {
        if (evaluation.scope !== 'site') return true;
        if (seenShared.has(evaluation.id)) return false;
        seenShared.add(evaluation.id);
        return true;
      });
      readiness.addPage({ ...row, evaluations: counted });
      web.addEvaluations(counted);
      addCheckCounts(checks, counted);
    }
    const tasks = await batchTasks(db, crawl, ids, rows);
    classification.add(rows, tasks);
    await eligibility.add(db, crawl, {
      selectedIds: ids,
      tasks: new Map(tasks.map((row) => [row.site_url_id ?? '', row])),
      evaluations: own,
    });
  });
  const aggregate = measurement.aggregate();
  return {
    selectedCount: selected,
    analysisIds,
    artifactIds,
    classification: classification.result(),
    aggregate,
    byPageKind: measurement.byPageKind(),
    eligibility: eligibility.result(),
    readinessDiagnostic: readiness.result(crawl, aggregate),
    webDiagnostic: web.result(artifactIds),
    checkCounts: { measured_check_count: checks.measured, expected_check_count: checks.expected },
  };
}

export type MeasurementProjection = Awaited<ReturnType<typeof measurementProjection>>;
export function scoreSummary(projection: MeasurementProjection, issueCount: number) {
  const {
    readiness_dimensions: _dimensions,
    analyzed_url_count: analyzed,
    ...aggregate
  } = projection.aggregate;
  return {
    ...aggregate,
    search_eligibility: 'unknown',
    analyzed_count: analyzed,
    selected_count: projection.selectedCount,
    issue_count: issueCount,
    ...projection.classification,
    presentation_version: policy.site_health.reads.measurement_versions.presentation,
    by_page_kind: projection.byPageKind,
  };
}
