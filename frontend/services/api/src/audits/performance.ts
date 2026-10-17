import type { Selectable } from 'kysely';
import { auditPerformanceSchema } from '@citeladder/contracts/audits';
import type { Database } from '../db/database.ts';
import type { AuditTasks, ExecutionCostProjections } from '../generated/db-schema.ts';
import { authorizedAudit } from './reads.ts';
import { compareText } from '../text-order.ts';

function counts(tasks: Selectable<AuditTasks>[]) {
  return {
    execution_count: tasks.length,
    completed_count: tasks.filter((task) => task.status === 'succeeded').length,
    failed_count: tasks.filter((task) => task.status === 'failed').length,
    retry_count: tasks.reduce((sum, task) => sum + Math.max(0, task.attempt_count - 1), 0),
    search_calls: tasks.reduce(
      (sum, task) => sum + (Array.isArray(task.search_events) ? task.search_events.length : 0),
      0,
    ),
  };
}
function projected(costs: Selectable<ExecutionCostProjections>[]) {
  const known = costs.flatMap((cost) =>
    cost.projected_total_cost_microusd === null ? [] : [Number(cost.projected_total_cost_microusd)],
  );
  return known.length ? known.reduce((sum, cost) => sum + cost, 0) : null;
}
function usage(
  costs: Selectable<ExecutionCostProjections>[],
  keys: ('uncached_input_tokens' | 'cached_input_tokens' | 'output_tokens' | 'total_tokens')[],
) {
  const known = costs.flatMap((cost) =>
    keys.flatMap((key) => (cost[key] === null ? [] : [cost[key]!])),
  );
  return known.length ? known.reduce((sum, count) => sum + count, 0) : null;
}
const elapsed = (end: Date | null, start: Date) =>
  end ? Math.trunc(end.getTime() - start.getTime()) : null;
export async function auditPerformance(db: Database, workspaceId: string, auditId: string) {
  const audit = await authorizedAudit(db, workspaceId, auditId);
  const tasks = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('audit_id', '=', auditId)
    .execute();
  const costs = await db
    .selectFrom('execution_cost_projections as c')
    .innerJoin('audit_tasks as t', 't.id', 'c.task_id')
    .selectAll('c')
    .where('t.workspace_id', '=', workspaceId)
    .where('t.audit_id', '=', auditId)
    .where('c.audit_id', '=', auditId)
    .distinctOn('c.raw_response_artifact_id')
    .orderBy('c.raw_response_artifact_id')
    .orderBy('c.created_at', 'desc')
    .orderBy('c.id', 'desc')
    .execute();
  const completed = tasks
    .flatMap((task) => (task.completed_at ? [task.completed_at] : []))
    .sort((a, b) => a.getTime() - b.getTime());
  const summary = counts(tasks);
  return auditPerformanceSchema.parse({
    audit_id: auditId,
    queue_wait_ms: elapsed(audit.started_at, audit.created_at),
    total_run_duration_ms: elapsed(audit.completed_at, audit.created_at),
    time_to_first_result_ms: elapsed(completed[0] ?? null, audit.created_at),
    ...summary,
    coverage: tasks.length ? summary.completed_count / tasks.length : 0,
    usage: costs.length
      ? {
          input_tokens: usage(costs, ['uncached_input_tokens', 'cached_input_tokens']),
          output_tokens: usage(costs, ['output_tokens']),
          total_tokens: usage(costs, ['total_tokens']),
        }
      : { input_tokens: null, output_tokens: null, total_tokens: null },
    projected_cost_microusd: projected(costs),
    engines: [...new Set(tasks.map((task) => task.logical_engine))]
      .sort(compareText)
      .map((engine) => {
        const rows = tasks.filter((task) => task.logical_engine === engine),
          ids = new Set(rows.map((task) => task.id));
        const latencies = rows.flatMap((task) =>
          task.latency_ms === null ? [] : [task.latency_ms],
        );
        return {
          logical_engine: engine,
          ...counts(rows),
          average_provider_latency_ms: latencies.length
            ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
            : null,
          projected_cost_microusd: projected(costs.filter((cost) => ids.has(cost.task_id))),
        };
      }),
  });
}
