import { listAudits, listExecutions, readAudit } from '../audits/reads.ts';
import { listSchedules } from '../audits/schedules.ts';
import { parseUuid } from '../http/uuid.ts';
import { mcpPolicy } from './config.ts';
import { decodeCursor, encodeCursor, pageOf, pagination, reference } from './data.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };
type Audit = Awaited<ReturnType<typeof readAudit>>;

const runSummary = (audit: Audit) => ({
  audit_id: audit.id,
  status: audit.status,
  cancelable: audit.cancelable,
  audit_scope: audit.audit_scope,
  parent_audit_id: audit.parent_audit_id,
  market: audit.market,
  requested_count: audit.requested_count,
  completed_count: audit.completed_count,
  failed_count: audit.failed_count,
  error_message: audit.error_message,
  created_at: audit.created_at,
  started_at: audit.started_at,
  completed_at: audit.completed_at,
});

export async function auditRuns({ db, scope }: ProjectRead, args: Page): Promise<Evidence> {
  let after: string | undefined;
  if (args.cursor) {
    const [key, id] = decodeCursor(args.cursor, 2);
    if (key !== 'runs' || !parseUuid(id)) throw new McpInputError('cursor is invalid');
    after = id;
  }
  const count = args.limit ?? mcpPolicy.default_list_limit;
  const audits = await listAudits(db, scope.workspaceId, scope.projectId, count + 1, after);
  const items = audits.slice(0, count).map(runSummary);
  const last = items.at(-1);
  return {
    state: 'available',
    view: 'runs',
    items,
    pagination: pagination(
      items,
      audits.length > count && last ? encodeCursor('runs', last.audit_id) : null,
    ),
    artifact_refs: items.map((item) => reference('audit', item.audit_id)),
  };
}

export async function auditRun(
  { db, scope }: ProjectRead,
  args: Page & { audit_id?: string | null },
): Promise<Evidence> {
  if (!args.audit_id) throw new McpInputError('view run needs audit_id');
  const audit = await readAudit(db, scope.workspaceId, args.audit_id);
  if (audit.project_id !== scope.projectId)
    throw new McpInputError('Audit was not found in this project');
  const executions = await listExecutions(db, scope.workspaceId, audit.id);
  const statusCounts: Record<string, number> = {};
  for (const execution of executions)
    statusCounts[execution.status] = (statusCounts[execution.status] ?? 0) + 1;
  const failures = pageOf(
    executions
      .filter((execution) => execution.status === 'failed')
      .map((execution) => ({
        id: execution.id,
        prompt_text: execution.prompt_text,
        engine: execution.logical_engine,
        provider: execution.transport_provider,
        error_code: execution.error_code,
      })),
    args,
    { endpoint: 'mcp_run_failures', filters: { audit_id: audit.id } },
  );
  return {
    state: 'available',
    view: 'run',
    run: runSummary(audit),
    execution_status_counts: statusCounts,
    failures: failures.items,
    pagination: failures.pagination,
    artifact_refs: [reference('audit', audit.id)],
  };
}

export async function auditSchedules({ db, scope }: ProjectRead, args: Page): Promise<Evidence> {
  const schedules = (await listSchedules(db, scope)).map((schedule) => ({
    id: schedule.id,
    prompt_set_id: schedule.prompt_set_id,
    audit_scope: schedule.audit_scope,
    cadence: schedule.cadence,
    interval_minutes: schedule.interval_minutes,
    timezone: schedule.timezone,
    engines: schedule.engines,
    market_ids: schedule.market_ids,
    enabled: schedule.enabled,
    next_run_at: schedule.next_run_at,
    last_run_at: schedule.last_run_at,
    failure_count: schedule.failure_count,
    last_error: schedule.last_error,
  }));
  const page = pageOf(schedules, args, {
    endpoint: 'mcp_audit_schedules',
    filters: { project_id: scope.projectId },
  });
  return { state: 'available', view: 'schedules', items: page.items, pagination: page.pagination };
}
