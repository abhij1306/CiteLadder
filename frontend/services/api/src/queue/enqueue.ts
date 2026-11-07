/**
 * The analytics queue's enqueue, with deterministic idempotency keys, and its
 * coalesced form for refreshes that absorb repeated requests.
 *
 * A key is `analytics:<kind>:<identity parts>`; with `ON CONFLICT DO NOTHING`
 * on the unique key, re-enqueueing the same logical task never adds a second
 * row (invariant 8).
 */
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';

import { policy, resolveSettingSpec } from '../config.ts';
import type { DB } from '../generated/db-schema.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { record } from '../db/json.ts';

type Enqueue = {
  workspaceId: string;
  projectId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  keyParts: readonly (string | number)[];
  /** The kind's attempt budget; defaults to the analytics task budget (`ANALYTICS_TASK_MAX_ATTEMPTS`). */
  maxAttempts?: number;
  idempotencyKey?: string;
  /** When the row becomes claimable; now unless the request is delayed. */
  availableAt?: Date;
};

/** The analytics task attempt budget successors inherit unless their kind sets its own. */
function defaultTaskMaxAttempts(): number {
  return resolveSettingSpec(policy.analytics.worker_settings.task_max_attempts) as number;
}

/** The deterministic `analytics:<kind>:<identity parts>` idempotency key. */
export function taskKey(kind: string, parts: readonly (string | number)[]): string {
  return ['analytics', kind, ...parts].join(':');
}

/** Insert one queue row unless its key exists; the new id, or null. */
export async function enqueueTask(
  db: Database | Transaction<DB>,
  task: Enqueue,
): Promise<string | null> {
  const now = new Date();
  const inserted = await db
    .insertInto('analytics_tasks')
    .values({
      id: randomUUID(),
      workspace_id: task.workspaceId,
      project_id: task.projectId,
      task_kind: task.kind,
      payload: JSON.stringify(task.payload),
      idempotency_key: task.idempotencyKey ?? taskKey(task.kind, task.keyParts),
      status: policy.task_queue.statuses.queued,
      priority: 0,
      randomized_position: 0,
      available_at: task.availableAt ?? now,
      attempt_count: 0,
      max_attempts: task.maxAttempts ?? defaultTaskMaxAttempts(),
      error_code: '',
      error_detail: '',
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) => conflict.column('idempotency_key').doNothing())
    .returning('id')
    .executeTakeFirst();
  return inserted?.id ?? null;
}

type Coalesced = {
  workspaceId: string;
  projectId: string;
  kind: string;
  /** The payload a new task starts with. */
  payload?: Record<string, unknown>;
  /** Payload fields a queued task must share to absorb this request; none when omitted. */
  coalesceOn?: readonly string[];
  /** The payload a queued task takes when it absorbs this request; unchanged when omitted. */
  merge?: (queued: Record<string, unknown>) => Record<string, unknown>;
  /** The debounce: the task is due this long after the request. */
  delaySeconds: number;
  maxAttempts?: number;
  /** Identity parts of a new task's key; a fresh successor key when omitted. */
  keyParts?: readonly (string | number)[];
  now?: Date;
};

/**
 * Request a refresh that coalesces with work not yet started.
 *
 * One advisory lock per kind, project and coalescing key serializes
 * concurrent requests. A queued task absorbs the request (merging its payload
 * when asked) and keeps the earliest deadline; leased or running work gets a
 * queued successor, since it may already have read the state this request
 * changes. The queued row stays locked until the caller commits, so a worker
 * cannot claim it before the change that requested it is visible. Returns the
 * queued task's id, or null when an explicit key already exists.
 */
export function enqueueCoalesced(db: Database, request: Coalesced): Promise<string | null> {
  return inTransaction(db, async (trx) => {
    const { workspaceId, projectId, kind } = request;
    const payload = request.payload ?? {};
    const coalesceOn = request.coalesceOn ?? [];
    const matches = coalesceOn.map((field) => [field, String(payload[field])] as const);
    await subjectXactLock(
      trx,
      ['coalesced', kind, workspaceId, projectId, ...matches.flat()].join(':'),
    );
    const now = request.now ?? new Date();
    const due = new Date(now.getTime() + request.delaySeconds * 1000);
    const pending = await trx
      .selectFrom('analytics_tasks')
      .select(['id', 'payload'])
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', projectId)
      .where('task_kind', '=', kind)
      .where('status', '=', policy.task_queue.statuses.queued)
      .$call((query) =>
        matches.reduce(
          (filtered, [field, value]) => filtered.where(sql<string>`payload->>${field}`, '=', value),
          query,
        ),
      )
      .orderBy('available_at')
      .orderBy('id')
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    if (!pending)
      return enqueueTask(trx, {
        workspaceId,
        projectId,
        kind,
        payload,
        keyParts: request.keyParts ?? [projectId, randomUUID()],
        maxAttempts: request.maxAttempts,
        availableAt: due,
      });
    await trx
      .updateTable('analytics_tasks')
      .set({
        available_at: sql<Date>`least(available_at, ${due}::timestamptz)`,
        ...(request.merge
          ? { payload: JSON.stringify(request.merge(record(pending.payload))) }
          : {}),
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', pending.id)
      .execute();
    return pending.id;
  });
}
