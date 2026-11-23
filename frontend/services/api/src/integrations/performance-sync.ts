import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { activePropertySync, enqueueSyncRun } from './sync.ts';

type Scope = Readonly<{ workspaceId: string; projectId: string }>;
type Target = Readonly<{ mapping_id: string; connection_id: string; project_id: string }>;

export function performanceTargets(db: Database, scope: Scope) {
  return db
    .selectFrom('integration_property_mappings as mapping')
    .innerJoin('integration_connections as connection', 'connection.id', 'mapping.connection_id')
    .innerJoin('integration_oauth_grants as grant', (join) =>
      join
        .onRef('grant.id', '=', 'connection.grant_id')
        .onRef('grant.workspace_id', '=', 'connection.workspace_id'),
    )
    .select([
      'mapping.id as mapping_id',
      'mapping.connection_id',
      'mapping.project_id',
      'mapping.property_ref',
      'connection.provider',
    ])
    .where('mapping.workspace_id', '=', scope.workspaceId)
    .where('mapping.project_id', '=', scope.projectId)
    .where('mapping.status', '=', 'active')
    .where('grant.status', '=', 'connected')
    .where('connection.provider', 'in', ['gsc', 'ga4', 'bing'])
    .orderBy('mapping.created_at', 'asc')
    .orderBy('mapping.id', 'asc')
    .execute();
}

async function onDemandRun(db: Database, workspaceId: string, target: Target) {
  try {
    return await enqueueSyncRun(db, {
      workspaceId,
      connectionId: target.connection_id,
      mappingId: target.mapping_id,
      projectId: target.project_id,
      syncKind: 'on_demand',
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'sync_target_unresolved') return null;
    if (error instanceof ApiError && error.code === 'sync_active_window_conflict')
      return (await activePropertySync(db, workspaceId, target.mapping_id)) ?? 'syncing';
    throw error;
  }
}

export async function syncProjectPerformance(db: Database, scope: Scope) {
  const queued = [];
  let syncing = 0;
  for (const target of await performanceTargets(db, scope)) {
    const run = await onDemandRun(db, scope.workspaceId, target); // NOSONAR
    if (run === 'syncing') syncing++;
    else if (run) queued.push(run);
  }
  if (queued.length === 0 && syncing > 0)
    throw new ApiError(409, 'A sync is already running for this project', {
      code: 'sync_active_window_conflict',
      details: { error: 'sync_active_window_conflict', enqueued_connection_ids: [] },
    });
  return queued;
}
