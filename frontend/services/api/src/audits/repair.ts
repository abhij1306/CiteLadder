import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { ApiError, notFound } from '../errors.ts';
import { auditPolicy } from './config.ts';
import { auditEvent, transitionAudit } from './state.ts';
import { compareText } from '../text-order.ts';

export const repairInput = z.object({
  provider: z.string().nullish(),
  engine: z.string().nullish(),
  prompt_id: z.uuid().nullish(),
  task_ids: z.array(z.uuid()).nullish(),
});
const denied = (message: string) => new ApiError(409, message);
/** A repair is an immutable child audit of selected failed frozen slots. */
export function createRepairAudit(
  db: Database,
  workspaceId: string,
  auditId: string,
  request: z.output<typeof repairInput>,
  at = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    const parent = await trx
      .selectFrom('audits')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', auditId)
      .forUpdate()
      .executeTakeFirst();
    if (!parent) throw notFound('Audit');
    if (!auditPolicy.constants.audit_terminal_statuses.includes(parent.status))
      throw denied('Only a terminal audit can be repaired');
    const prompts = await trx
      .selectFrom('audit_prompt_snapshots')
      .selectAll()
      .where('audit_id', '=', parent.id)
      .execute();
    const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));
    const selectedIds = new Set(request.task_ids ?? []);
    const rows = await trx
      .selectFrom('audit_tasks')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('audit_id', '=', auditId)
      .where('status', '=', 'failed')
      .orderBy('randomized_position')
      .execute();
    const tasks = rows.filter(
      (task) =>
        (!request.provider || task.transport_provider === request.provider) &&
        (!request.engine || task.logical_engine === request.engine) &&
        (!selectedIds.size || selectedIds.has(task.id)) &&
        (!request.prompt_id ||
          promptMap.get(task.prompt_snapshot_id)?.prompt_id === request.prompt_id),
    );
    if (
      selectedIds.size &&
      (selectedIds.size !== tasks.length || tasks.some((task) => !selectedIds.has(task.id)))
    )
      throw denied('task_ids must identify failed tasks in this audit');
    if (!tasks.length) throw denied('No failed tasks match the repair filters');
    const key = createHash('sha256')
      .update(
        tasks
          .map((task) => task.id)
          .sort(compareText)
          .join('|'),
      )
      .digest('hex');
    const existing = await trx
      .selectFrom('audits')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('parent_audit_id', '=', auditId)
      .where('repair_key', '=', key)
      .executeTakeFirst();
    if (existing) return { auditId: existing.id, created: false };
    const id = randomUUID();
    await trx
      .insertInto('audits')
      .values({
        id,
        workspace_id: workspaceId,
        project_id: parent.project_id,
        parent_audit_id: parent.id,
        repair_key: key,
        schedule_id: null,
        scheduled_for: null,
        status: 'draft',
        trigger: 'repair',
        benchmark_mode: parent.benchmark_mode,
        audit_scope: parent.audit_scope,
        system_instruction: parent.system_instruction,
        repetitions: parent.repetitions,
        random_seed: randomBytes(8).readBigUInt64BE().toString(),
        requested_count: tasks.length,
        completed_count: 0,
        failed_count: 0,
        configuration: JSON.stringify({
          ...record(parent.configuration),
          repair_parent_audit_id: parent.id,
          repair_source_task_ids: tasks.map((task) => task.id),
        }),
        error_message: '',
        analyzer_version: '',
        summary: null,
        funding_account_id: null,
        funded_budget_period_start: null,
        created_at: at,
        updated_at: at,
        started_at: null,
        completed_at: null,
      })
      .execute();
    const clones = new Map<string, string>();
    const promptClones = prompts
      .filter((prompt) => tasks.some((task) => task.prompt_snapshot_id === prompt.id))
      .map((prompt) => {
        const cloneId = randomUUID();
        clones.set(prompt.id, cloneId);
        return {
          ...prompt,
          id: cloneId,
          audit_id: id,
          created_at: at,
          generation_evidence:
            prompt.generation_evidence === null ? null : JSON.stringify(prompt.generation_evidence),
        };
      });
    await trx.insertInto('audit_prompt_snapshots').values(promptClones).execute();
    const engines = await trx
      .selectFrom('audit_engine_snapshots')
      .selectAll()
      .where('audit_id', '=', parent.id)
      .execute();
    const engineClones = new Map<string, string>();
    const clonedEngines = engines
      .filter((engine) => tasks.some((task) => task.engine_snapshot_id === engine.id))
      .map((engine) => {
        const cloneId = randomUUID();
        engineClones.set(engine.id, cloneId);
        return { ...engine, id: cloneId, audit_id: id, created_at: at };
      });
    await trx.insertInto('audit_engine_snapshots').values(clonedEngines).execute();
    await trx
      .insertInto('audit_tasks')
      .values(
        tasks.map((task, position) => ({
          ...task,
          id: randomUUID(),
          audit_id: id,
          source_task_id: task.id,
          prompt_snapshot_id: clones.get(task.prompt_snapshot_id)!,
          engine_snapshot_id: engineClones.get(task.engine_snapshot_id)!,
          randomized_position: position,
          idempotency_key: `${id}:${task.prompt_index}:${task.repetition}:${task.logical_engine}`,
          provider_route_snapshot: JSON.stringify(task.provider_route_snapshot),
          request_snapshot: JSON.stringify(task.request_snapshot),
          status: 'queued',
          available_at: at,
          priority: 0,
          attempt_count: 0,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          completed_at: null,
          created_at: at,
          updated_at: at,
          answer_text: '',
          error_code: '',
          error_detail: '',
          latency_ms: null,
          provider_metadata: null,
          search_used: false,
          search_events: null,
          citations: null,
          score: null,
          result_artifact_id: null,
          provider_task_id: '',
          provider_submission_ref: '',
          provider_task_submitted_at: null,
          provider_poll_count: 0,
          provider_connection_id: null,
          provider_credential_revision: null,
          finish_reason: 'unknown',
          raw_finish_reason: null,
        })),
      )
      .execute();
    await transitionAudit(trx, workspaceId, id, 'validating', at, 'repair audit validating');
    await transitionAudit(trx, workspaceId, id, 'queued', at, 'repair audit queued');
    await auditEvent(
      trx,
      id,
      auditPolicy.constants.event_audit_created,
      'repair audit created',
      {
        requested_count: tasks.length,
        engines: [...new Set(tasks.map((task) => task.logical_engine))].sort(compareText),
      },
      at,
    );
    await auditEvent(
      trx,
      id,
      auditPolicy.constants.event_audit_queued,
      'repair audit queued',
      { task_count: tasks.length },
      at,
    );
    return { auditId: id, created: true };
  });
}
