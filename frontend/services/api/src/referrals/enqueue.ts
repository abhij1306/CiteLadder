/**
 * The referral chain's successor enqueues, with deterministic idempotency keys.
 *
 * The integration completion owner starts the chain. A key is
 * `analytics:<kind>:<identity parts>`; with
 * `ON CONFLICT DO NOTHING` on the unique key, re-enqueueing the same logical
 * task never adds a second row.
 */
import { randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';

import { policy } from '../config.ts';
import type { DB } from '../generated/db-schema.ts';
import type { Database } from '../db/database.ts';

const KIND_CLASSIFY = 'classify_referrals';
const KIND_SNAPSHOT_REFRESH = 'ai_referrals_snapshot_refresh';

type Enqueue = {
  workspaceId: string;
  projectId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  keyParts: readonly (string | number)[];
  maxAttempts: number;
  idempotencyKey?: string;
};

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
      max_attempts: task.maxAttempts,
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

/** Classification of the events one artifact ingested. */
export function enqueueClassifyReferrals(
  db: Database,
  options: { workspaceId: string; projectId: string; artifactId: string; maxAttempts: number },
): Promise<string | null> {
  return enqueueTask(db, {
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    kind: KIND_CLASSIFY,
    payload: { import_artifact_id: options.artifactId },
    keyParts: [options.projectId, options.artifactId],
    maxAttempts: options.maxAttempts,
  });
}

/**
 * An AI Referrals snapshot rebuild for one sync window. The key carries the
 * data revision, so a re-sync of a projected window re-fires the refresh
 * while a same-revision duplicate still dedupes.
 */
export function enqueueAiReferralsSnapshotRefresh(
  db: Database,
  options: {
    workspaceId: string;
    projectId: string;
    windowStart: string;
    windowEnd: string;
    resyncSeq: number;
    sourceRevision: string;
    maxAttempts: number;
  },
): Promise<string | null> {
  return enqueueTask(db, {
    workspaceId: options.workspaceId,
    projectId: options.projectId,
    kind: KIND_SNAPSHOT_REFRESH,
    payload: {
      window_start: options.windowStart,
      window_end: options.windowEnd,
      source_revision: options.sourceRevision,
    },
    keyParts: [
      options.projectId,
      options.windowStart,
      options.windowEnd,
      options.resyncSeq,
      options.sourceRevision,
    ],
    maxAttempts: options.maxAttempts,
  });
}
