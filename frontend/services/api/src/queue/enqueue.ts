import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';

import { policy } from '../config.ts';
import { resolveSettingSpec } from '../config/settings.ts';
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
  maxAttempts?: number;
  idempotencyKey?: string;
  availableAt?: Date;
};

function defaultTaskMaxAttempts(): number {
  return resolveSettingSpec(
    policy.analytics.worker_settings.task_max_attempts,
    process.env,
  ) as number;
}

export function taskKey(kind: string, parts: readonly (string | number)[]): string {
  return ['analytics', kind, ...parts].join(':');
}

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
  payload?: Record<string, unknown>;
  coalesceOn?: readonly string[];
  merge?: (queued: Record<string, unknown>) => Record<string, unknown>;
  delaySeconds: number;
  maxAttempts?: number;
  keyParts?: readonly (string | number)[];
  now?: Date;
};

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
