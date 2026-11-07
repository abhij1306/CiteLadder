/**
 * The analytics queue's one enqueue, with deterministic idempotency keys.
 *
 * A key is `analytics:<kind>:<identity parts>`; with `ON CONFLICT DO NOTHING`
 * on the unique key, re-enqueueing the same logical task never adds a second
 * row (invariant 8).
 */
import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';

import { policy, resolveSettingSpec } from '../config.ts';
import type { DB } from '../generated/db-schema.ts';
import type { Database } from '../db/database.ts';

type Enqueue = {
  workspaceId: string;
  projectId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  keyParts: readonly (string | number)[];
  /** The kind's attempt budget; defaults to the analytics task budget (`ANALYTICS_TASK_MAX_ATTEMPTS`). */
  maxAttempts?: number;
  idempotencyKey?: string;
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
      available_at: now,
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
