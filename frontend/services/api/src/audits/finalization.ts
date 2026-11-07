import { sql, type Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { getLogger } from '../logging.ts';
import { insightsRefresh } from '../config/ai-traffic.ts';
import { enqueueCoalesced } from '../queue/enqueue.ts';
import { persistComparisonBaselines } from '../visibility/baselines.ts';
import { deriveRunMetrics } from '../analysis/finalization.ts';
import { auditEvent, transitionAudit } from './state.ts';
import { deriveExecution } from './derivation.ts';
import type { DeriveExecution } from './result-persistence.ts';

function tallyStatusCounts(statusCounts: { status: string; count: string }[]) {
  let completed = 0,
    failed = 0,
    open = 0;
  for (const { status, count } of statusCounts) {
    if (status === 'succeeded') completed += Number(count);
    else if (policy.task_queue.terminal.includes(status)) failed += Number(count);
    else open += Number(count);
  }
  return { completed, failed, open };
}

/**
 * Root lock serializes progress and finalization. Once every task settled, the run moves
 * through analyzing, derives its metrics (analysis owns that), runs the caller's Commerce
 * projection, completes, refreshes comparison baselines and queues downstream insights.
 */
export function finalizeAudit(
  db: Database,
  workspaceId: string,
  auditId: string,
  commerce: (db: Database, audit: Selectable<Audits>) => Promise<void>,
  at = new Date(),
  derive: DeriveExecution = deriveExecution,
) {
  return db.transaction().execute(async (trx) => {
    const audit = await trx
      .selectFrom('audits')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', auditId)
      .forUpdate()
      .executeTakeFirst();
    if (!audit || policy.audits.constants.audit_terminal_statuses.includes(audit.status))
      return null;
    // Every settled task calls this; count by status so progress costs one aggregate, not a row load.
    const statusCounts = await trx
      .selectFrom('audit_tasks')
      .select((eb) => ['status', eb.fn.countAll<string>().as('count')])
      .where('workspace_id', '=', workspaceId)
      .where('audit_id', '=', audit.id)
      .groupBy('status')
      .execute();
    const { completed, failed, open } = tallyStatusCounts(statusCounts);
    if (audit.completed_count !== completed || audit.failed_count !== failed)
      await trx
        .updateTable('audits')
        .set({ completed_count: completed, failed_count: failed, updated_at: at })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', audit.id)
        .execute();
    if (open) return null;
    const tasks = await trx
      .selectFrom('audit_tasks as t')
      .innerJoin('audit_prompt_snapshots as p', (join) =>
        join.onRef('p.id', '=', 't.prompt_snapshot_id').onRef('p.audit_id', '=', 't.audit_id'),
      )
      .selectAll('t')
      .select('p.cohort')
      .where('t.workspace_id', '=', workspaceId)
      .where('t.audit_id', '=', audit.id)
      .orderBy('t.randomized_position')
      .execute();
    if (audit.status === 'queued') await transitionAudit(trx, workspaceId, auditId, 'running', at);
    if (!completed) {
      await transitionAudit(
        trx,
        workspaceId,
        auditId,
        'failed',
        at,
        'audit failed: no successful executions',
      );
      await trx
        .updateTable('audits')
        .set({ completed_at: at, error_message: 'no successful executions' })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', auditId)
        .execute();
      return null;
    }
    if (['queued', 'running'].includes(audit.status))
      await transitionAudit(
        trx,
        workspaceId,
        auditId,
        'analyzing',
        at,
        'execution complete; ready for analysis',
      );
    else if (audit.status !== 'analyzing') return null;
    const run = await deriveRunMetrics(trx, audit, tasks, derive, at);
    const { metric } = run;
    await sql`savepoint commerce_shelf_finalization`.execute(trx);
    try {
      await commerce(trx, audit);
    } catch {
      await sql`rollback to savepoint commerce_shelf_finalization`.execute(trx);
      getLogger('workers.audit').info('commerce_shelf_finalization_failed', { audit_id: audit.id });
    }
    await sql`release savepoint commerce_shelf_finalization`.execute(trx);
    await trx
      .updateTable('audits')
      .set({
        summary: JSON.stringify(run.metrics),
        analyzer_version: policy.audits.analysis.analyzer_version,
        completed_count: run.completed,
        failed_count: metric.total_failed,
        completed_at: audit.completed_at ?? at,
        updated_at: at,
      })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', auditId)
      .execute();
    await transitionAudit(trx, workspaceId, auditId, 'reporting', at, 'aggregating metrics');
    const status = metric.total_failed ? 'partially_completed' : 'completed';
    await transitionAudit(trx, workspaceId, auditId, status, at, `audit ${status}`);
    // The run's comparable baseline, by the one comparison rule, for every
    // surface that reads it. It runs once the run reads as measured, so later
    // runs it refreshes find it among their candidates.
    await persistComparisonBaselines(trx, { workspaceId, auditId });
    await enqueueCoalesced(trx, {
      ...insightsRefresh,
      workspaceId,
      projectId: audit.project_id,
      now: at,
    });
    await auditEvent(
      trx,
      auditId,
      policy.audits.constants.event_audit_completed,
      `audit ${status}`,
      {
        status,
        completed: run.completed,
        failed: metric.total_failed,
        visibility_score: run.visibility,
      },
      at,
    );
    return metric;
  });
}
