/** Durable recovery of failed work, including sweeper-terminalized tasks. */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { getLogger } from '../logging.ts';
import type { QueueTask, ClaimScope } from '../queue/task-queue.ts';
import { compensateInternalLinks } from '../site-health/internal-link-judgments.ts';
import { compensateInspection } from '../source-pages/inspector.ts';
import { compensatePerception } from '../perception/executor.ts';
import { compensateFactVerification } from '../perception/fact-verification.ts';

const compensators: Record<string, (db: Database, task: QueueTask) => Promise<void>> = {
  source_page_inspection: compensateInspection,
  internal_link_judgment: compensateInternalLinks,
  answer_perception: compensatePerception,
  fact_verification: compensateFactVerification,
};

function mark(db: Database, task: QueueTask, fields: Record<string, unknown>) {
  return db
    .updateTable('analytics_tasks')
    .set({ payload: JSON.stringify({ ...record(task.payload), ...fields }) })
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .where('status', '=', 'failed')
    .execute();
}

/**
 * Retries a failing compensator, rotated behind untried rows, until it has
 * failed `terminal_compensation_max_failures` times; then the task is
 * abandoned as compensated so it stops recurring.
 */
export async function compensateTerminalTasks(db: Database, scope?: ClaimScope) {
  if (scope && !scope.taskIds.length) return;
  const { terminal_compensation_batch: batch, terminal_compensation_max_failures: maxFailures } =
    policy.analytics;
  const tasks = await db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('task_kind', 'in', Object.keys(compensators))
    .where('status', '=', 'failed')
    .$if(!!scope, (q) =>
      q.where('workspace_id', '=', scope!.workspaceId).where('id', 'in', [...scope!.taskIds]),
    )
    .where(sql<boolean>`payload->>'terminal_compensated_at' is null`)
    .orderBy(sql`payload->>'terminal_compensation_failed_at' asc nulls first`)
    .orderBy('completed_at')
    .limit(batch)
    .execute();
  for (const task of tasks) {
    const now = new Date().toISOString();
    try {
      await compensators[task.task_kind]!(db, task);
      await mark(db, task, { terminal_compensated_at: now });
    } catch (error) {
      const failures = Number(record(task.payload).terminal_compensation_failures ?? 0) + 1;
      const abandoned = failures >= maxFailures;
      getLogger('app.workers.terminal_compensation').exception(
        abandoned ? 'terminal compensation abandoned' : 'terminal compensation failed',
        error,
        { task_id: task.id, failures },
      );
      await mark(db, task, {
        terminal_compensation_failures: failures,
        terminal_compensation_failed_at: now,
        ...(abandoned ? { terminal_compensated_at: now } : {}),
      });
    }
  }
}
