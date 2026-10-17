import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { isoDateText, wireUtc, utcText } from '../db/timestamps.ts';
import { policy } from '../config.ts';
import { ApiError, notFound } from '../errors.ts';
import { parseUuid } from '../http/uuid.ts';
import { parseDate } from '../http/datetimes.ts';
import { record, strings } from '../db/json.ts';
import { normalizeQuery } from './classification.ts';
import { querySnapshots, type DemandScope } from './query-evidence.ts';
import {
  queryEvidenceState,
  resolutionCandidates,
  resolutionOutcome,
} from '../routes/demand-contracts.ts';

const timestampColumns = () => [
  isoDateText(sql.ref('window_start')).as('start'),
  isoDateText(sql.ref('window_end')).as('end'),
  utcText(sql.ref('created_at')).as('at'),
];
/** One explicit persisted origin, including its exact parent and processing versions. */
export async function readDemandOrigin(
  db: Database,
  scope: Pick<DemandScope, 'workspaceId' | 'projectId'>,
  id: string,
) {
  const signal = await db
    .selectFrom('demand_signals')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!signal) throw notFound('Demand signal');
  const snapshot = await db
    .selectFrom('demand_snapshots')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', signal.snapshot_id)
    .executeTakeFirst();
  if (!snapshot) throw notFound('Demand snapshot');
  return { signal, snapshot };
}
export async function latestDemand(db: Database, workspaceId: string, projectId: string) {
  const scope = new WorkspaceScope(workspaceId);
  const snapshot = await scope
    .selectFrom(db, 'demand_snapshots')
    .selectAll()
    .select(timestampColumns())
    .where('project_id', '=', projectId)
    // The most recent observed period, as Opportunities selects it.
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!snapshot) throw notFound('Demand snapshot');
  const signals = await scope
    .selectFrom(db, 'demand_signals')
    .selectAll()
    .select(utcText(sql.ref('created_at')).as('at'))
    .where('project_id', '=', projectId)
    .where('snapshot_id', '=', snapshot.id)
    .orderBy(sql`priority_score desc nulls last`)
    .orderBy('id')
    .limit(policy.demand.DEMAND_LIST_MAX_LIMIT)
    .execute();
  const actions = signals.length
    ? await scope
        .selectFrom(db, 'opportunities')
        .select(['target_key', 'action_id'])
        .where('project_id', '=', projectId)
        .where(
          'target_key',
          'in',
          signals.map((r) => `demand:${r.identity_hash}`),
        )
        .where('superseded_at', 'is', null)
        .where('action_id', 'is not', null)
        .execute()
    : [];
  const byIdentity = new Map(actions.map((r) => [r.target_key, r.action_id]));
  return {
    id: snapshot.id,
    project_id: projectId,
    window_start: snapshot.start,
    window_end: snapshot.end,
    source_hash: snapshot.source_hash,
    prior_snapshot_id: snapshot.prior_snapshot_id,
    source_artifact_ids: strings(snapshot.source_artifact_ids),
    source_metric_row_ids: strings(snapshot.source_metric_row_ids),
    coverage: record(snapshot.coverage),
    summary: record(snapshot.summary),
    comparison: snapshot.comparison === null ? null : record(snapshot.comparison),
    formula_version: snapshot.formula_version,
    analyzer_version: snapshot.analyzer_version,
    created_at: wireUtc(snapshot.at!),
    signals: signals.map((r) => ({
      id: r.id,
      snapshot_id: r.snapshot_id,
      signal_type: r.signal_type,
      state: r.state,
      topic_cluster: r.topic_cluster,
      page_url: r.page_url,
      evidence: record(r.evidence),
      metrics: record(r.metrics),
      coverage: record(r.coverage),
      limitations: strings(r.limitations),
      priority_score: r.priority_score,
      priority_inputs: record(r.priority_inputs),
      created_at: wireUtc(r.at!),
      action_id: byIdentity.get(`demand:${r.identity_hash}`) ?? null,
    })),
  };
}

async function requiredQuerySnapshot(db: Database, scope: DemandScope) {
  const row = await querySnapshots(db, scope)
    .select(timestampColumns())
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!row) throw notFound('Query evidence snapshot');
  return {
    id: row.id,
    project_id: row.project_id,
    window_start: row.start,
    window_end: row.end,
    source_hash: row.source_hash,
    supersedes_snapshot_id: row.supersedes_snapshot_id,
    state: queryEvidenceState.parse(row.state),
    source_metric_row_ids: strings(row.source_metric_row_ids),
    source_artifact_ids: strings(row.source_artifact_ids),
    coverage: record(row.coverage),
    limitations: strings(row.limitations),
    analyzer_version: row.analyzer_version,
    resolver_version: row.resolver_version,
    created_at: wireUtc(row.at!),
  };
}
function invalidCursor(): never {
  throw new ApiError(422, 'The query evidence cursor is invalid', {
    code: 'query_evidence_cursor_invalid',
  });
}

export async function queryEvidencePage(
  db: Database,
  scope: DemandScope,
  options: {
    limit: number;
    cursor: string | null;
    query: string | null;
    site_url_id: string | null;
    resolution_outcome: string | null;
  },
) {
  const snapshot = await requiredQuerySnapshot(db, scope);
  let query = new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'query_evidence_rows')
    .selectAll()
    .select(isoDateText(sql.ref('date')).as('day'))
    .where('project_id', '=', scope.projectId)
    .where('snapshot_id', '=', snapshot.id);
  if (options.query) query = query.where('normalized_query', '=', normalizeQuery(options.query));
  if (options.site_url_id) query = query.where('site_url_id', '=', options.site_url_id);
  if (options.resolution_outcome)
    query = query.where('resolution_outcome', '=', options.resolution_outcome);
  if (options.cursor) {
    let key: unknown;
    try {
      key = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
    } catch {
      invalidCursor();
    }
    if (
      !Array.isArray(key) ||
      key.length !== 3 ||
      parseUuid(key[0]) !== snapshot.id ||
      typeof key[1] !== 'string' ||
      parseDate(key[1]) === null ||
      !parseUuid(key[2])
    )
      invalidCursor();
    query = query.where(sql<boolean>`(date, id) > (${key[1]}::date, ${key[2]}::uuid)`);
  }
  const limit = Math.min(Math.max(options.limit, 1), policy.demand.QUERY_EVIDENCE_MAX_LIMIT);
  const rows = await query
    .orderBy('date')
    .orderBy('id')
    .limit(limit + 1)
    .execute();
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    snapshot,
    items: selected.map((r) => ({
      id: r.id,
      date: r.day,
      normalized_query: r.normalized_query,
      observed_page_url: r.observed_page_url,
      site_url_id: r.site_url_id,
      resolved_page_url: r.resolved_page_url,
      resolution_outcome: resolutionOutcome.parse(r.resolution_outcome),
      resolution_candidates: resolutionCandidates.parse(r.resolution_candidates),
      property_ref: r.property_ref,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      position: r.position,
      source_metric_row_id: r.source_metric_row_id,
      source_artifact_id: r.source_artifact_id,
      importer_version: r.importer_version,
      resolver_version: r.resolver_version,
    })),
    next_cursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify([snapshot.id, last.day, last.id])).toString('base64url')
        : null,
  };
}

export async function queryEvidenceSummary(db: Database, scope: DemandScope) {
  const snapshot = await requiredQuerySnapshot(db, scope);
  const counts = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'query_evidence_rows')
    .select(['resolution_outcome', sql<string>`count(*)`.as('count')])
    .where('project_id', '=', scope.projectId)
    .where('snapshot_id', '=', snapshot.id)
    .groupBy('resolution_outcome')
    .execute();
  return {
    snapshot,
    counts_by_resolution: Object.fromEntries(
      counts.map((r) => [r.resolution_outcome, Number(r.count)]),
    ),
  };
}
