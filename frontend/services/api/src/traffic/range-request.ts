import { performanceRangeTaskStatusSchema } from '@citeladder/contracts/performance';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError, notFound } from '../errors.ts';
import { enqueueTask, taskKey } from '../queue/enqueue.ts';
import { scalarText } from '../text-order.ts';
import { clampedCustomWindow } from './performance.ts';

type Scope = Readonly<{ workspaceId: string; projectId: string }>;

const KIND = 'performance_range_projection';
const { statuses } = policy.task_queue;
const retryable = new Set<string>([statuses.failed, statuses.cancelled]);

export function performanceRangeTask(task: { id: string; status: string; payload: unknown }) {
  const payload = record(task.payload);
  return {
    task_id: task.id,
    status: performanceRangeTaskStatusSchema.parse(task.status),
    window_start: scalarText(payload.window_start ?? ''),
    window_end: scalarText(payload.window_end ?? ''),
  };
}

export async function requestPerformanceRange(
  db: Database,
  scope: Scope,
  range: Readonly<{ from: string; to: string }>,
) {
  const { window, latest } = await clampedCustomWindow(db, scope, range.from, range.to);
  if (!window) throw new ApiError(422, "'from' and 'to' must be supplied together");
  const [from, to] = window;
  if (latest !== null && from > latest)
    throw new ApiError(422, `'from' is after the latest imported date (${latest})`);
  const tasks = () =>
    new WorkspaceScope(scope.workspaceId)
      .selectFrom(db, 'analytics_tasks')
      .select(['id', 'status', 'payload'])
      .where('project_id', '=', scope.projectId)
      .where('task_kind', '=', KIND);
  const previous = await tasks()
    .where(sql<boolean>`payload->>'window_start' = ${from} and payload->>'window_end' = ${to}`)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (previous && !retryable.has(previous.status)) return performanceRangeTask(previous);
  const keyParts = previous
    ? [scope.projectId, from, to, 'after', previous.id]
    : [scope.projectId, from, to];
  await enqueueTask(db, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    kind: KIND,
    payload: { window_start: from, window_end: to },
    keyParts,
  });
  const row = await tasks()
    .where('idempotency_key', '=', taskKey(KIND, keyParts))
    .executeTakeFirst();
  if (!row) throw notFound('Performance range task');
  return performanceRangeTask(row);
}
