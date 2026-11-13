/**
 * The `page_fetch` analytics task's identity and payload: one task per chat and
 * page URL. Kept apart from the executor so the Agent store can enqueue it and
 * check for it without importing the fetch.
 */
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { enqueueTask } from '../queue/enqueue.ts';

export const PAGE_FETCH_KIND = 'page_fetch';

/**
 * What the fetch needs to read the page and then queue the chat's first turn.
 * Not strict: terminal compensation adds its own bookkeeping to a failed task.
 */
export const pageFetchPayloadSchema = z.object({
  chat_id: z.uuid(),
  url: z.url(),
  site_url_id: z.uuid().nullable(),
  action_id: z.uuid().nullable(),
  /** The chat's first message, which the queued turn answers. */
  user_message_id: z.uuid(),
  user_id: z.uuid(),
  /** The creating request's key and fingerprint, so a retried request replays this chat. */
  request_key: z.string().min(1),
  request_fingerprint: z.string().min(1),
  /** The model admission chose when the chat was created; each model call re-checks it. */
  requested_model: z.string(),
  workflow_id: z.string(),
  mention_ids: z.array(z.uuid()),
});
export type PageFetchPayload = z.infer<typeof pageFetchPayloadSchema>;

/** Commits the chat's page fetch in the caller's transaction, before any network I/O. */
export function enqueuePageFetch(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  payload: PageFetchPayload,
) {
  return enqueueTask(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: PAGE_FETCH_KIND,
    payload: pageFetchPayloadSchema.parse(payload),
    keyParts: [payload.chat_id, payload.url],
    maxAttempts: policy.content_optimization.page_fetch.max_attempts,
  });
}

/** The idempotency key of the turn a page fetch queues: one turn per fetch task. */
export function pageTurnKey(taskId: string) {
  return `${PAGE_FETCH_KIND}:${taskId}`;
}

/** The page fetch a create request already committed, found by the request's key. */
export function pageFetchByRequest(db: Database, workspaceId: string, requestKey: string) {
  return db
    .selectFrom('analytics_tasks')
    .select(['id', 'project_id', 'payload'])
    .where('workspace_id', '=', workspaceId)
    .where('task_kind', '=', PAGE_FETCH_KIND)
    .where(sql<string>`payload->>'request_key'`, '=', requestKey)
    .executeTakeFirst();
}

/** The chat's page fetch task, the newest first; undefined for a chat that never fetched. */
export function chatPageFetch(db: Database, workspaceId: string, chatId: string) {
  return db
    .selectFrom('analytics_tasks')
    .select(['id', 'status'])
    .where('workspace_id', '=', workspaceId)
    .where('task_kind', '=', PAGE_FETCH_KIND)
    .where(sql<string>`payload->>'chat_id'`, '=', chatId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/** Whether the chat's page is still being read: no turn may start until it is. */
export async function pageFetchActive(db: Database, workspaceId: string, chatId: string) {
  const task = await chatPageFetch(db, workspaceId, chatId);
  return task !== undefined && policy.task_queue.active.includes(task.status);
}
