/** Exact source and classification revisions used by admission and recomputation. */
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { isoDateText } from '../db/timestamps.ts';
import { policy } from '../config.ts';
import { addDays } from '../referrals/projection.ts';
import { numberOrNull } from '../traffic/accumulators.ts';
import { record, strings } from '../db/json.ts';
import { classifyProjectQueries } from './classification.ts';
import { stableHash, unique, type QueryInput, type SearchInput } from './projection.ts';
import { latestQuerySnapshot, queryEvidenceRevision, type DemandScope } from './query-evidence.ts';
import { compareText, scalarText } from '../text-order.ts';

export async function trafficSource(db: Database, scope: DemandScope) {
  const workspace = new WorkspaceScope(scope.workspaceId);
  const snapshot = await workspace
    .selectFrom(db, 'traffic_snapshots')
    .selectAll()
    .where('project_id', '=', scope.projectId)
    .where('window_start', '=', sql<Date>`${scope.windowStart}::date`)
    .where('window_end', '=', sql<Date>`${scope.windowEnd}::date`)
    .where('granularity', '=', 'day')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const inputs: SearchInput[] = [];
  if (snapshot) {
    const queries = await workspace
      .selectFrom(db, 'traffic_query_stats')
      .selectAll()
      .where('project_id', '=', scope.projectId)
      .where('snapshot_id', '=', snapshot.id)
      .execute();
    const pages = await workspace
      .selectFrom(db, 'traffic_page_stats')
      .selectAll()
      .where('project_id', '=', scope.projectId)
      .where('snapshot_id', '=', snapshot.id)
      .execute();
    for (const r of [
      ...queries.map((r) => ({ ...r, target_kind: 'query', target: r.normalized_query })),
      ...pages.map((r) => ({ ...r, target_kind: 'page', target: r.canonical_url })),
    ]) {
      const metrics = record(r.metrics),
        impressions = numberOrNull(metrics.impressions),
        clicks = numberOrNull(metrics.clicks);
      if (impressions !== null && clicks !== null)
        inputs.push({
          source_metric_row_ids: strings(r.source_metric_row_ids),
          source_artifact_ids: strings(r.source_artifact_ids),
          target_kind: r.target_kind,
          target: r.target,
          impressions: Math.trunc(impressions),
          clicks: Math.trunc(clicks),
        });
    }
  }
  const material = {
    window: [scope.windowStart, scope.windowEnd],
    traffic_snapshot_id: snapshot?.id ?? null,
    metric_ids: unique(inputs.flatMap((r) => r.source_metric_row_ids)),
    analyzer_version: policy.demand.DEMAND_ANALYZER_VERSION,
    formula_version: policy.demand.DEMAND_FORMULA_VERSION,
  };
  return { snapshot, inputs, material };
}

export async function queryDetectorInputs(
  db: Database,
  scope: DemandScope,
  snapshotId: string,
): Promise<QueryInput[]> {
  const rows = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'query_evidence_rows')
    .selectAll()
    .select(isoDateText(sql.ref('date')).as('day'))
    .where('project_id', '=', scope.projectId)
    .where('snapshot_id', '=', snapshotId)
    .orderBy('date')
    .orderBy('id')
    .execute();
  const ids = unique(rows.flatMap((r) => (r.site_url_id ? [r.site_url_id] : [])));
  const facts = ids.length
    ? await db
        .selectFrom('site_page_analyses as a')
        .innerJoin('site_fetch_artifacts as f', 'f.id', 'a.artifact_id')
        .select([
          'a.site_url_id',
          'a.id as analysis_id',
          'f.id as artifact_id',
          'f.normalized_facts',
        ])
        .where('a.workspace_id', '=', scope.workspaceId)
        .where('a.project_id', '=', scope.projectId)
        .where('f.workspace_id', '=', scope.workspaceId)
        .where('a.site_url_id', 'in', ids)
        .where('a.status', '=', 'completed')
        .where('a.created_at', '>=', new Date(`${scope.windowStart}T00:00:00Z`))
        .where('a.created_at', '<', new Date(`${addDays(scope.windowEnd, 1)}T00:00:00Z`))
        // Only each page's newest analysis; its facts carry the full page text.
        .distinctOn('a.site_url_id')
        .orderBy('a.site_url_id')
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .execute()
    : [];
  const byPage = new Map(facts.map((fact) => [fact.site_url_id, fact]));
  const classifications = await classifyProjectQueries(
    db,
    scope.workspaceId,
    scope.projectId,
    rows.map((r) => r.normalized_query),
  );
  return rows.flatMap((row) => {
    const classification = classifications.get(row.normalized_query);
    if (!classification) return [];
    const fact = row.site_url_id ? byPage.get(row.site_url_id) : undefined;
    const f = record(fact?.normalized_facts),
      headings = record(f.headings);
    const title = scalarText(f.title ?? ''),
      h1 = strings(headings.h1_texts),
      primary = scalarText(f.primary_content_text ?? '');
    return [
      {
        observed_date: row.day,
        property_ref: row.property_ref,
        normalized_query: row.normalized_query,
        resolved_page_url: row.resolved_page_url,
        resolution_outcome: row.resolution_outcome,
        classification: classification.classification,
        classifier_version: classification.classifier_version,
        classification_override_id: classification.override_id,
        impressions: row.impressions,
        clicks: row.clicks,
        position: row.position,
        source_metric_row_id: row.source_metric_row_id,
        source_artifact_id: row.source_artifact_id,
        page_title: title,
        page_h1_texts: h1,
        page_primary_content: primary,
        page_content_usable:
          ['exact', 'resolved'].includes(row.resolution_outcome) &&
          !!(title.trim() || h1.some((v) => v.trim()) || primary.trim()),
        page_analysis_id: fact?.analysis_id ?? null,
        page_artifact_id: fact?.artifact_id ?? null,
      },
    ];
  });
}

export async function sourceMaterial(
  db: Database,
  scope: DemandScope,
  traffic: Awaited<ReturnType<typeof trafficSource>>,
  queryInputs: QueryInput[],
  queryRevision: string,
) {
  const queries = unique([
    ...traffic.inputs.filter((r) => r.target_kind === 'query').map((r) => r.target),
    ...queryInputs.map((r) => r.normalized_query),
  ]);
  const classifications = await classifyProjectQueries(
    db,
    scope.workspaceId,
    scope.projectId,
    queries,
  );
  return {
    traffic: traffic.material,
    query_evidence_revision: queryRevision,
    query_classifications: [...classifications]
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, v]) => ({
        query: key,
        classification: v.classification,
        classifier_version: v.classifier_version,
        override_id: v.override_id,
      })),
    page_evidence: unique(
      queryInputs.flatMap((r) =>
        r.page_analysis_id && r.page_artifact_id
          ? [JSON.stringify([r.page_analysis_id, r.page_artifact_id])]
          : [],
      ),
    ).map((v) => JSON.parse(v) as string[]),
  };
}

export async function demandSourceRevision(db: Database, scope: DemandScope) {
  const traffic = await trafficSource(db, scope);
  const queryRevision = await queryEvidenceRevision(db, scope);
  const snapshot = await latestQuerySnapshot(db, scope);
  const inputs = snapshot ? await queryDetectorInputs(db, scope, snapshot.id) : [];
  return stableHash(await sourceMaterial(db, scope, traffic, inputs, queryRevision)).slice(0, 24);
}
