import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { compareText } from '../text-order.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import type { Scope } from '../opportunities/sources.ts';
import { isoDateText } from '../db/timestamps.ts';

type BackfillWindow = {
  connection_id: string;
  mapping_id: string | null;
  window_start: string;
  window_end: string;
  status: string;
};
function connectionRollup(windows: BackfillWindow[], id: string) {
  const attempts = new Map<string, { start: string; end: string; statuses: Set<string> }>();
  for (const run of windows.filter((row) => row.connection_id === id)) {
    const start = run.window_start,
      end = run.window_end;
    const key = `${run.mapping_id}:${start}:${end}`;
    const item = attempts.get(key) ?? { start, end, statuses: new Set<string>() };
    item.statuses.add(run.status);
    attempts.set(key, item);
  }
  const all = [...attempts.values()];
  const completed = all.filter((row) => row.statuses.has('succeeded'));
  const failed = all.filter(
    (row) =>
      !row.statuses.has('succeeded') &&
      [...row.statuses].every((status) => status === 'failed' || status === 'cancelled'),
  );
  let through: string | null = null;
  for (const row of completed) {
    if (through !== null && Date.parse(row.start) > Date.parse(through) + 86_400_000) break;
    if (through === null || row.end > through) through = row.end;
  }
  let state = 'complete';
  if (!all.length) state = 'not_started';
  else if (all.length - completed.length - failed.length) state = 'importing';
  else if (failed.length) state = 'partial';
  return { state, completed: completed.length, through };
}
function backfillState(rollups: ReturnType<typeof connectionRollup>[]) {
  if (!rollups.length) return null;
  if (rollups.every((row) => row.state === 'not_started')) return 'not_started';
  if (rollups.some((row) => row.state === 'importing')) return 'importing';
  if (rollups.every((row) => row.state === 'complete')) return 'complete';
  return 'partial';
}
function readinessStage(
  connected: boolean,
  backfill: string | null,
  performance: boolean,
  demand: boolean,
  imported: boolean,
) {
  if (!connected) return 'not_connected';
  if (backfill === null || backfill === 'not_started') {
    return performance ? 'core_data_ready' : 'connected';
  }
  if (backfill === 'importing') return 'importing';
  if (performance) return demand ? 'analysis_ready' : 'core_data_ready';
  return imported ? 'importing' : 'import_failed';
}

/**
 * Project grain: one connection's unrelated project imports are not coverage.
 * Shared persisted projection for readiness HTTP and MCP reads.
 */
export async function readProjectReadiness(db: Database, scope: Scope) {
  const workspace = new WorkspaceScope(scope.workspaceId);
  const mappings = await workspace
    .selectFrom(db, 'integration_property_mappings')
    .innerJoin('integration_connections as c', (join) =>
      join
        .onRef('c.id', '=', 'integration_property_mappings.connection_id')
        .onRef('c.workspace_id', '=', 'integration_property_mappings.workspace_id'),
    )
    .innerJoin('integration_oauth_grants as g', (join) =>
      join.onRef('g.id', '=', 'c.grant_id').onRef('g.workspace_id', '=', 'c.workspace_id'),
    )
    .select([
      'integration_property_mappings.id as mapping_id',
      'c.id',
      'c.provider',
      'c.label',
      'c.last_synced_at',
      'g.status as grant_status',
      'integration_property_mappings.property_ref',
    ])
    .where('integration_property_mappings.project_id', '=', scope.projectId)
    .where('integration_property_mappings.status', '=', 'active')
    .orderBy('c.provider')
    .orderBy('c.id')
    .execute();
  const live = mappings.filter((row) => row.grant_status === 'connected');
  const connectionIds = [...new Set(live.map((row) => row.id))];
  const windows = live.length
    ? await workspace
        .selectFrom(db, 'integration_sync_runs')
        .select(['connection_id', 'mapping_id', 'status'])
        .select([
          isoDateText(sql.ref('window_start')).as('window_start'),
          isoDateText(sql.ref('window_end')).as('window_end'),
        ])
        .where('project_id', '=', scope.projectId)
        .where(
          'mapping_id',
          'in',
          live.map((row) => row.mapping_id),
        )
        .where('sync_kind', '=', 'backfill')
        .orderBy('window_start')
        .orderBy('window_end')
        .execute()
    : [];
  const rollups = connectionIds.map((id) => connectionRollup(windows, id));
  const backfill = backfillState(rollups);
  const covered = rollups.map((row) => row.through);
  const importedThrough =
    covered.length && covered.every((value) => value !== null)
      ? (covered as string[]).sort(compareText)[0]
      : null;
  const performance = await workspace
    .selectFrom(db, 'traffic_snapshots')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .limit(1)
    .executeTakeFirst();
  const demand = await workspace
    .selectFrom(db, 'demand_snapshots')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .limit(1)
    .executeTakeFirst();
  const opportunities = await workspace
    .selectFrom(db, 'opportunities')
    .select(sql<string>`count(*)`.as('count'))
    .where('project_id', '=', scope.projectId)
    .where('superseded_at', 'is', null)
    .executeTakeFirstOrThrow();
  const stage = readinessStage(
    connectionIds.length > 0,
    backfill,
    !!performance,
    !!demand,
    rollups.some((row) => row.completed > 0),
  );
  return {
    project_id: scope.projectId,
    providers: [...new Set(live.map((row) => row.provider))].sort(compareText),
    state: 'available',
    stage,
    connection_count: connectionIds.length,
    backfill_state: backfill,
    imported_through: importedThrough,
    has_performance_snapshot: !!performance,
    has_demand_snapshot: !!demand,
    opportunity_count: Number(opportunities.count),
    connections: mappings.map(({ id: _id, mapping_id: _mapping, ...row }) => row),
    artifact_refs: connectionIds.map((id) => ({
      kind: 'integration_connection',
      id,
      record_uri: null,
      retrievable: false,
      reason: 'raw_record_not_exposed',
    })),
    omissions: [],
  };
}
