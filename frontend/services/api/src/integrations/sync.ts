import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import { codes, integrationPolicy, integrationSettings } from './config.ts';
import { policy } from '../config.ts';
import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { isoDateText } from '../db/timestamps.ts';

const settings = integrationSettings();

function isoDay(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isoTimestamp(value: Date | string): string;
function isoTimestamp(value: Date | string | null): string | null;
function isoTimestamp(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function day(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function dateAfter(value: string, days: number): string {
  return new Date(day(value) + days * 86_400_000).toISOString().slice(0, 10);
}

function windowFor(start: string | undefined, end: string | undefined): [string, string] {
  if ((start === undefined) !== (end === undefined)) {
    throw new ApiError(422, 'The requested sync window is invalid', {
      code: 'sync_window_invalid',
    });
  }
  const yesterday = isoDay(new Date(Date.now() - 86_400_000));
  if (start === undefined || end === undefined) {
    return [dateAfter(yesterday, -(settings.sync_default_window_days - 1)), yesterday];
  }
  if (!Number.isFinite(day(start)) || !Number.isFinite(day(end)) || start > end) {
    throw new ApiError(422, 'The requested sync window is invalid', {
      code: 'sync_window_invalid',
    });
  }
  const boundedStart =
    day(end) - day(start) >= settings.sync_backfill_max_days * 86_400_000
      ? dateAfter(end, -(settings.sync_backfill_max_days - 1))
      : start;
  return [boundedStart, end];
}

export function enqueueSyncRun(db: Database, input: SyncInput) {
  return db.transaction().execute(async (trx) => {
    const workspace = await trx
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', input.workspaceId)
      .where('is_system', '=', false)
      .forUpdate()
      .executeTakeFirst();
    if (!workspace) throw notFound('Workspace');
    const target = await resolveSyncTarget(trx, input);
    const [windowStart, windowEnd] = await syncWindow(trx, input, target.id);
    const kind = input.syncKind ?? 'on_demand';
    // A plain sync re-reads the late-data days, which an active on-demand or
    // scheduled run for the property already covers; refusing it under the
    // workspace lock keeps one in flight. Explicit windows and history backfill
    // are separate ranges.
    if (input.windowStart === undefined && kind !== codes.SYNC_KIND_BACKFILL)
      await refuseWhilePropertySyncs(trx, input.workspaceId, target.id);
    if (kind === 'on_demand')
      await admitOnDemandSync(trx, input.workspaceId, target.id, windowStart, windowEnd);
    const prior = await previousSequence(trx, input, target);
    const sequence = (prior?.resync_seq ?? -1) + 1;
    const id = randomUUID();
    const now = new Date();
    const key = `sync:${input.connectionId}:${target.id}:${kind}:${windowStart}:${windowEnd}:${sequence}`;
    try {
      await trx
        .insertInto('integration_sync_runs')
        .values({
          id,
          workspace_id: input.workspaceId,
          connection_id: input.connectionId,
          mapping_id: target.id,
          property_ref: target.property_ref,
          project_id: target.project_id,
          sync_kind: kind,
          window_start: new Date(`${windowStart}T00:00:00Z`),
          window_end: new Date(`${windowEnd}T00:00:00Z`),
          resync_seq: sequence,
          idempotency_key: key,
          status: 'queued',
          priority: 0,
          randomized_position: 0,
          available_at: now,
          attempt_count: 0,
          max_attempts: settings.sync_max_attempts,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          error_code: '',
          error_detail: '',
          created_at: now,
          updated_at: now,
          completed_at: null,
        })
        .execute();
    } catch (error) {
      if (String(error).includes('ix_integration_sync_runs_active_window')) {
        throw new ApiError(409, 'A sync window is already active for this connection', {
          code: 'sync_active_window_conflict',
          details: { enqueued_connection_ids: [] },
        });
      }
      throw error;
    }
    return { sync_run_id: id, connection_id: input.connectionId, status: 'queued' };
  });
}

const ACTIVE_SYNC = ['queued', 'leased', 'running', 'retry_wait'] as const;

/** The property's active on-demand or scheduled run, which a plain sync waits on. */
export async function activePropertySync(db: Database, workspaceId: string, mappingId: string) {
  const run = await db
    .selectFrom('integration_sync_runs')
    .select(['id', 'connection_id', 'status'])
    .where('workspace_id', '=', workspaceId)
    .where('mapping_id', '=', mappingId)
    .where('sync_kind', '!=', codes.SYNC_KIND_BACKFILL)
    .where('status', 'in', ACTIVE_SYNC)
    .executeTakeFirst();
  return run && { sync_run_id: run.id, connection_id: run.connection_id, status: run.status };
}

async function refuseWhilePropertySyncs(trx: Database, workspaceId: string, mappingId: string) {
  if (await activePropertySync(trx, workspaceId, mappingId))
    throw new ApiError(409, 'A sync is already running for this property', {
      code: 'sync_active_window_conflict',
      details: { enqueued_connection_ids: [] },
    });
}

async function admitOnDemandSync(
  trx: Database,
  workspaceId: string,
  mappingId: string,
  start: string,
  end: string,
) {
  const active = trx
    .selectFrom('integration_sync_runs')
    .where('workspace_id', '=', workspaceId)
    .where('status', 'in', ACTIVE_SYNC);
  const duplicate = await active
    .select('id')
    .where('mapping_id', '=', mappingId)
    .where('sync_kind', '=', 'on_demand')
    .where('window_start', '=', new Date(`${start}T00:00:00Z`))
    .where('window_end', '=', new Date(`${end}T00:00:00Z`))
    .executeTakeFirst();
  if (duplicate)
    throw new ApiError(409, 'A sync window is already active for this connection', {
      code: 'sync_active_window_conflict',
      details: { enqueued_connection_ids: [] },
    });
  const count = await active
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  if (Number(count.count) >= settings.sync_on_demand_active_limit)
    throw new ApiError(429, 'Workspace sync capacity exceeded');
  await enforceWorkspaceRequest(trx, workspaceId, {
    operation: 'integrations.sync.on_demand',
    limit: settings.sync_on_demand_request_limit,
    windowSeconds: settings.sync_on_demand_request_window_seconds,
  });
}

async function resolveSyncTarget(trx: Database, input: SyncInput) {
  const connection = await trx
    .selectFrom('integration_connections')
    .select('id')
    .where('id', '=', input.connectionId)
    .where('workspace_id', '=', input.workspaceId)
    .forUpdate()
    .executeTakeFirst();
  if (connection === undefined) throw notFound('Integration connection');

  let mappings = trx
    .selectFrom('integration_property_mappings')
    .selectAll()
    .where('connection_id', '=', input.connectionId)
    .where('workspace_id', '=', input.workspaceId)
    .where('status', '=', 'active');
  if (input.projectId !== undefined) mappings = mappings.where('project_id', '=', input.projectId);
  if (input.mappingId !== undefined) mappings = mappings.where('id', '=', input.mappingId);
  const targets = await mappings.execute();
  if (targets.length === 0) {
    throw new ApiError(409, 'Select a property for this project before syncing', {
      code: 'sync_target_unresolved',
    });
  }
  if (targets.length > 1) {
    throw new ApiError(409, 'Name project_id: this connection serves several projects', {
      code: 'sync_target_unresolved',
    });
  }
  const target = targets[0];
  if (target === undefined) throw new Error('resolved sync target disappeared');

  return target;
}

/**
 * An unwindowed on-demand or scheduled sync re-reads only the late-data days
 * after the newest succeeded window; the default window applies only before
 * anything has succeeded. Older gaps belong to history retry, so one failed
 * history chunk never turns every sync into a full re-import.
 */
async function syncWindow(
  trx: Database,
  input: SyncInput,
  mappingId: string,
): Promise<[string, string]> {
  let [windowStart, windowEnd] = windowFor(input.windowStart, input.windowEnd);
  if (
    input.windowStart === undefined &&
    input.windowEnd === undefined &&
    (input.syncKind ?? 'on_demand') !== 'backfill'
  ) {
    const yesterday = isoDay(new Date(Date.now() - 86_400_000));
    const latest = await trx
      .selectFrom('integration_sync_runs')
      .select(isoDateText(sql`max(window_end)`).as('covered'))
      .where('mapping_id', '=', mappingId)
      .where('workspace_id', '=', input.workspaceId)
      .where('status', '=', 'succeeded')
      .executeTakeFirst();
    const covered = latest?.covered ?? null;
    if (covered !== null) {
      const earliest = dateAfter(yesterday, -(settings.sync_backfill_max_days - 1));
      windowStart = dateAfter(covered, 1 - settings.sync_late_data_revision_days);
      if (windowStart < earliest) windowStart = earliest;
      if (windowStart > yesterday) windowStart = yesterday;
      windowEnd = yesterday;
    }
  }

  return [windowStart, windowEnd];
}

function previousSequence(
  trx: Database,
  input: SyncInput,
  target: Awaited<ReturnType<typeof resolveSyncTarget>>,
) {
  return trx
    .selectFrom('integration_sync_runs')
    .select('resync_seq')
    .where('workspace_id', '=', input.workspaceId)
    .where((eb) =>
      eb.or([
        eb('connection_id', '=', input.connectionId),
        eb.and([
          eb('project_id', '=', target.project_id),
          eb('property_ref', '=', target.property_ref),
        ]),
      ]),
    )
    .orderBy('resync_seq', 'desc')
    .limit(1)
    .executeTakeFirst();
}

type SyncInput = {
  workspaceId: string;
  connectionId: string;
  mappingId?: string;
  projectId?: string;
  windowStart?: string;
  windowEnd?: string;
  syncKind?: 'on_demand' | 'scheduled' | 'backfill';
};

/** Enqueue the configured history's missing or failed immutable windows. */
export async function enqueueHistoryBackfill(db: Database, input: BackfillInput): Promise<void> {
  const candidates = await backfillWindows(db, input, settings.sync_backfill_max_days);
  // Preserve per-window conflict handling and commit order during backfill.
  for (const [windowStart, windowEnd] of candidates) {
    try {
      await enqueueSyncRun(db, {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        mappingId: input.mappingId,
        projectId: input.projectId,
        windowStart,
        windowEnd,
        syncKind: 'backfill',
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'sync_active_window_conflict') continue;
      throw error;
    }
  }
}

type BackfillInput = {
  workspaceId: string;
  connectionId: string;
  mappingId: string;
  projectId: string;
  propertyRef: string;
};

async function backfillWindows(
  db: Database,
  input: BackfillInput,
  days: number,
): Promise<Array<[string, string]>> {
  const prior = await db
    .selectFrom('integration_sync_runs')
    .select([
      sql<string>`window_start::text`.as('window_start'),
      sql<string>`window_end::text`.as('window_end'),
      'status',
    ])
    .where('workspace_id', '=', input.workspaceId)
    .where('project_id', '=', input.projectId)
    .where('property_ref', '=', input.propertyRef)
    .where('sync_kind', '=', 'backfill')
    .execute();
  const alive = new Set(
    prior
      .filter((row) => !['failed', 'cancelled'].includes(row.status))
      .map((row) => `${isoDay(row.window_start)}:${isoDay(row.window_end)}`),
  );
  const candidates: Array<[string, string]> = [];
  if (prior.length) {
    for (const row of prior) {
      const window = [isoDay(row.window_start), isoDay(row.window_end)] as [string, string];
      if (['failed', 'cancelled'].includes(row.status) && !alive.has(`${window[0]}:${window[1]}`))
        candidates.push(window);
    }
  } else {
    const end = isoDay(new Date(Date.now() - 86_400_000));
    let start = dateAfter(end, -(days - 1));
    while (start <= end) {
      const chunkEnd = dateAfter(start, settings.sync_backfill_max_days - 1);
      const boundedEnd = chunkEnd < end ? chunkEnd : end;
      candidates.push([start, boundedEnd]);
      start = dateAfter(boundedEnd, 1);
    }
  }

  return candidates;
}

function backfillState(total: number, pending: number, failed: number): string {
  if (total === 0) return 'not_started';
  if (pending > 0) return 'importing';
  if (failed > 0) return 'partial';
  return 'complete';
}

/** One sync run of the connection, with its imported row count; undefined when absent. */
export async function getSyncRun(
  db: Database,
  workspaceId: string,
  connectionId: string,
  syncRunId: string,
) {
  const connection = await db
    .selectFrom('integration_connections')
    .select('id')
    .where('id', '=', connectionId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (connection === undefined) throw notFound('Integration connection');
  const row = await db
    .selectFrom('integration_sync_runs as runs')
    .leftJoin('integration_import_artifacts as artifacts', (join) =>
      join
        .onRef('artifacts.sync_run_id', '=', 'runs.id')
        .onRef('artifacts.workspace_id', '=', 'runs.workspace_id'),
    )
    .select([
      'runs.id',
      'runs.connection_id',
      'runs.sync_kind',
      'runs.status',
      'runs.resync_seq',
      'runs.error_code',
      'runs.error_detail',
      'runs.created_at',
      'runs.updated_at',
      'runs.completed_at',
    ])
    .select([
      sql<string>`runs.window_start::text`.as('window_start'),
      sql<string>`runs.window_end::text`.as('window_end'),
    ])
    .select((eb) =>
      eb.fn.coalesce(eb.fn.sum<number>('artifacts.row_count'), eb.val(0)).as('row_count'),
    )
    // The pages read projections, not imports: work after the import is still
    // building them while any post-sync task for the project is active.
    .select((eb) =>
      eb
        .exists(
          eb
            .selectFrom('analytics_tasks as tasks')
            .select('tasks.id')
            .whereRef('tasks.workspace_id', '=', 'runs.workspace_id')
            .whereRef('tasks.project_id', '=', 'runs.project_id')
            .where('tasks.task_kind', 'in', integrationPolicy.post_sync_task_kinds)
            .where('tasks.status', 'in', policy.task_queue.active),
        )
        .as('processing'),
    )
    .where('runs.workspace_id', '=', workspaceId)
    .where('runs.connection_id', '=', connectionId)
    .where('runs.id', '=', syncRunId)
    .groupBy(['runs.id'])
    .executeTakeFirst();
  return (
    row && {
      ...row,
      window_start: isoDay(row.window_start),
      window_end: isoDay(row.window_end),
      created_at: isoTimestamp(row.created_at),
      updated_at: isoTimestamp(row.updated_at),
      completed_at: isoTimestamp(row.completed_at),
      row_count: Number(row.row_count),
      processing: Boolean(row.processing),
    }
  );
}

export async function listMappings(db: Database, workspaceId: string, connectionId: string) {
  const connection = await db
    .selectFrom('integration_connections')
    .select('id')
    .where('id', '=', connectionId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (connection === undefined) throw notFound('Integration connection');
  const rows = await db
    .selectFrom('integration_property_mappings')
    .select([
      'id',
      'workspace_id',
      'connection_id',
      'provider',
      'property_ref',
      'project_id',
      'status',
      'created_at',
      'updated_at',
      'reporting_timezone',
      'currency_code',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('connection_id', '=', connectionId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows.map((row) => ({
    ...row,
    created_at: isoTimestamp(row.created_at),
    updated_at: isoTimestamp(row.updated_at),
  }));
}

export async function getBackfillProgress(db: Database, workspaceId: string, connectionId: string) {
  const connection = await db
    .selectFrom('integration_connections')
    .select('id')
    .where('id', '=', connectionId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (connection === undefined) throw notFound('Integration connection');
  const runs = await db
    .selectFrom('integration_sync_runs')
    .select([
      'mapping_id',
      'status',
      sql<string>`window_start::text`.as('window_start'),
      sql<string>`window_end::text`.as('window_end'),
    ])
    .where('workspace_id', '=', workspaceId)
    .where('connection_id', '=', connectionId)
    .where('sync_kind', '=', 'backfill')
    .execute();
  const attempts = new Map<string, Set<string>>();
  for (const run of runs) {
    const key = `${run.mapping_id}:${isoDay(run.window_start)}:${isoDay(run.window_end)}`;
    const statusesForWindow = attempts.get(key) ?? new Set<string>();
    statusesForWindow.add(run.status);
    attempts.set(key, statusesForWindow);
  }
  const succeededKeys = new Set(
    [...attempts].flatMap(([key, statusesForWindow]) =>
      statusesForWindow.has('succeeded') ? [key] : [],
    ),
  );
  const failed = [...attempts.values()].filter(
    (statusesForWindow) =>
      !statusesForWindow.has('succeeded') &&
      [...statusesForWindow].every((status) => ['failed', 'cancelled'].includes(status)),
  ).length;
  const completed = succeededKeys.size;
  const pending = attempts.size - completed - failed;
  const windows = runs
    .filter((run) =>
      succeededKeys.has(`${run.mapping_id}:${isoDay(run.window_start)}:${isoDay(run.window_end)}`),
    )
    .map((run) => [isoDay(run.window_start), isoDay(run.window_end)] as const)
    .sort();
  let from: string | null = null;
  let through: string | null = null;
  for (const [start, end] of windows) {
    if (from === null) {
      from = start;
      through = end;
      continue;
    }
    if (start > dateAfter(through!, 1)) break;
    if (end > through!) through = end;
  }
  const state = backfillState(attempts.size, pending, failed);
  return {
    connection_id: connectionId,
    state,
    total_windows: attempts.size,
    completed_windows: completed,
    failed_windows: failed,
    pending_windows: pending,
    covered_from: from,
    covered_through: through,
  };
}
