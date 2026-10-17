/** Append-only query/page projections over bounded, latest-revision evidence. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { numberOrNull } from '../traffic/accumulators.ts';
import { record } from '../db/json.ts';
import { normalizeQuery } from './classification.ts';
import { resolveOwnedPages } from './page-equivalence.ts';
import { stableHash, unique } from './projection.ts';
import { compareText } from '../text-order.ts';
import { selectedPartition, partitionQuality, partitionEpoch } from '../integrations/partitions.ts';

const p = policy.demand;
export type DemandScope = {
  workspaceId: string;
  projectId: string;
  windowStart: string;
  windowEnd: string;
};

export function querySnapshots(db: Database, scope: DemandScope) {
  return new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'query_evidence_snapshots')
    .selectAll()
    .where('project_id', '=', scope.projectId)
    .where('window_start', '=', sql<Date>`${scope.windowStart}::date`)
    .where('window_end', '=', sql<Date>`${scope.windowEnd}::date`);
}
export function latestQuerySnapshot(db: Database, scope: DemandScope) {
  return querySnapshots(db, scope)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
}

/**
 * The selected revision's rows: one per identity, because the partition rule
 * selects one resync_seq and `uq_integration_metric_row_identity` admits one
 * row per identity within it (a repeated provider row is dropped on insert).
 * Truncation keeps the highest-impression rows, newest first.
 */
async function sourceRows(db: Database, scope: DemandScope) {
  const rows = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'integration_metric_rows')
    .selectAll()
    .select(isoDateText(sql.ref('date')).as('day'))
    .where('project_id', '=', scope.projectId)
    .where('dataset', '=', p.query_page_dataset)
    .where(selectedPartition())
    .where('date', '>=', sql<Date>`${scope.windowStart}::date`)
    .where('date', '<=', sql<Date>`${scope.windowEnd}::date`)
    .orderBy(
      sql`case when jsonb_typeof(metrics->'impressions')='number'
        then (metrics->>'impressions')::double precision end desc nulls last`,
    )
    .orderBy('date', 'desc')
    .orderBy('id')
    .limit(p.QUERY_EVIDENCE_MAX_ROWS + 1)
    .execute();
  return rows;
}

async function sourceMaterial(db: Database, scope: DemandScope) {
  const epoch = await partitionEpoch(db, scope);
  const rows = await sourceRows(db, scope);
  const material = rows.flatMap((row) => {
    const parts = row.dimension_key.split(policy.traffic.dimension_key_separator);
    const page = parts.at(-2);
    if (parts.length < 3 || page === undefined) return [];
    const query = parts.slice(0, -2).join(policy.traffic.dimension_key_separator);
    const normalized = normalizeQuery(query);
    const metrics = record(row.metrics);
    const nonnegative = (key: string) => {
      const n = numberOrNull(metrics[key]);
      return n !== null && n >= 0 ? n : null;
    };
    const impressions = nonnegative('impressions'),
      clicks = nonnegative('clicks');
    if (!normalized || !page || impressions === null || clicks === null) return [];
    return [
      {
        source: row,
        normalized_query: normalized,
        observed_page_url: page,
        impressions: Math.trunc(impressions),
        clicks: Math.trunc(clicks),
        ctr: nonnegative('ctr'),
        position: nonnegative('position'),
      },
    ];
  });
  const quality = await partitionQuality(
    db,
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      start: scope.windowStart,
      end: scope.windowEnd,
    },
    p.query_page_dataset,
  );
  const artifactIds = unique(quality.flatMap((q) => q.artifact_ids));
  const matched = artifactIds.length
    ? await db
        .selectFrom('integration_import_artifacts')
        .selectAll()
        .where('workspace_id', '=', scope.workspaceId)
        .where('id', 'in', artifactIds.slice(0, p.QUERY_EVIDENCE_MAX_ARTIFACTS))
        .orderBy('id')
        .execute()
    : [];
  if ((await partitionEpoch(db, scope)) !== epoch)
    throw new Error('Integration partitions changed during Demand projection; retry');
  const key = (r: (typeof material)[number]) =>
    [r.source.day, r.source.dataset, r.source.dimension_key, r.source.id].join('\0');
  // Truncate in priority order, then project in a stable identity order.
  const selected = material
    .slice(0, p.QUERY_EVIDENCE_MAX_ROWS)
    .sort((a, b) => compareText(key(a), key(b)));
  const sourceHash = stableHash({
    window: [scope.windowStart, scope.windowEnd],
    rows: selected.map((r) => [r.source.id, r.source.resync_seq]),
    zero_artifacts: matched.map((r) => [r.id, r.payload_hash]),
    partitions: quality,
    analyzer_version: p.QUERY_EVIDENCE_ANALYZER_VERSION,
    resolver_version: p.PAGE_EQUIVALENCE_RESOLVER_VERSION,
  });
  return { rows, material, selected, artifacts: matched, sourceHash, quality };
}
export async function queryEvidenceRevision(db: Database, scope: DemandScope) {
  return (await sourceMaterial(db, scope)).sourceHash.slice(0, 24);
}

export async function buildQueryEvidence(db: Database, scope: DemandScope) {
  const { rows, material, selected, artifacts, sourceHash, quality } = await sourceMaterial(
    db,
    scope,
  );
  const existingQuery = () =>
    querySnapshots(db, scope)
      .where('source_hash', '=', sourceHash)
      .where('analyzer_version', '=', p.QUERY_EVIDENCE_ANALYZER_VERSION);
  const existing = await existingQuery().executeTakeFirst();
  if (existing) return existing;
  const prior = await latestQuerySnapshot(db, scope);
  const resolutions = await resolveOwnedPages(
    db,
    scope.workspaceId,
    scope.projectId,
    selected.map((r) => r.observed_page_url),
  );
  const truncated = rows.length > p.QUERY_EVIDENCE_MAX_ROWS || material.length > selected.length;
  const limitations = [
    ...unique(quality.flatMap((q) => q.flags)),
    ...(truncated ? ['query_evidence_row_limit'] : []),
    ...(material.length !== rows.length ? ['malformed_source_rows_excluded'] : []),
  ];
  let state = p.QUERY_EVIDENCE_STATE_UNAVAILABLE;
  if (selected.length) state = p.QUERY_EVIDENCE_STATE_AVAILABLE;
  else if (
    artifacts.length &&
    rows.length === material.length &&
    quality.every((q) => q.revision !== null && q.flags.length === 0)
  )
    state = p.QUERY_EVIDENCE_STATE_OBSERVED_ZERO;
  const snapshot = await db
    .insertInto('query_evidence_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      window_start: scope.windowStart,
      window_end: scope.windowEnd,
      source_hash: sourceHash,
      supersedes_snapshot_id: prior?.id ?? null,
      state,
      source_metric_row_ids: JSON.stringify(selected.map((r) => r.source.id)),
      source_artifact_ids: JSON.stringify(
        unique([
          ...selected.map((r) => r.source.source_artifact_id),
          ...artifacts.map((r) => r.id),
        ]),
      ),
      coverage: JSON.stringify({
        analytics_quality: quality,
        source_row_count: rows.length,
        usable_row_count: material.length,
        projected_row_count: selected.length,
        row_limit: p.QUERY_EVIDENCE_MAX_ROWS,
        truncated,
      }),
      limitations: JSON.stringify(limitations),
      analyzer_version: p.QUERY_EVIDENCE_ANALYZER_VERSION,
      resolver_version: p.PAGE_EQUIVALENCE_RESOLVER_VERSION,
      created_at: new Date(),
    })
    .onConflict((c) => c.constraint('uq_query_evidence_snapshot_identity').doNothing())
    .returningAll()
    .executeTakeFirst();
  if (!snapshot) return existingQuery().executeTakeFirstOrThrow();
  const size = policy.traffic.TRAFFIC_METRIC_ROW_BATCH_SIZE;
  for (let i = 0; i < selected.length; i += size)
    await db
      .insertInto('query_evidence_rows')
      .values(
        selected.slice(i, i + size).map((item) => {
          const r = resolutions.get(item.observed_page_url)!;
          return {
            id: randomUUID(),
            snapshot_id: snapshot.id,
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            date: item.source.day,
            normalized_query: item.normalized_query,
            observed_page_url: item.observed_page_url,
            site_url_id: r.site_url_id,
            resolved_page_url:
              r.candidates.find((c) => c.site_url_id === r.site_url_id)?.normalized_url ?? '',
            resolution_outcome: r.outcome,
            resolution_candidates: JSON.stringify(
              r.candidates.map((c) => ({
                site_url_id: c.site_url_id,
                normalized_url: c.normalized_url,
                evidence: c.evidence,
              })),
            ),
            property_ref: item.source.property_ref,
            impressions: item.impressions,
            clicks: item.clicks,
            ctr: item.ctr,
            position: item.position,
            source_metric_row_id: item.source.id,
            source_artifact_id: item.source.source_artifact_id,
            importer_version: item.source.importer_version,
            resolver_version: r.resolver_version,
            created_at: new Date(),
          };
        }),
      )
      .execute();
  return snapshot;
}
