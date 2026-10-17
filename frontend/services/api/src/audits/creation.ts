import { randomUUID } from 'node:crypto';
import { inTransaction, type Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { ApiError, notFound } from '../errors.ts';
import { searchPolicy } from '../search-surfaces/dataforseo.ts';
import type { Engine } from '../providers/config.ts';
import { auditSlots, prepareAudit } from './freeze.ts';
import { reserveAuditCapacity, type FrozenAudit } from './admission.ts';
import { auditEvent, transitionAudit } from './state.ts';
import { auditPolicy, auditRuntime, type AuditRuntime } from './config.ts';
import { auditInput, type AuditInput } from './inputs.ts';
import { resolveMarkets, type Market } from '../projects/markets.ts';

export type AuditLaunch = {
  trigger?: string;
  scheduleId?: string;
  scheduledFor?: Date;
};
type AuditScope = { workspaceId: string; projectId: string };

/**
 * One launch: an audit per selected market, committed together with one
 * shared `launch_id`, or none at all. Returns the audit ids in market order.
 */
export function createAudits(
  db: Database,
  workspaceId: string,
  request: AuditInput,
  launch: AuditLaunch = {},
  runtime: AuditRuntime = auditRuntime(),
  at = new Date(),
) {
  return inTransaction(db, (trx) =>
    createAuditsInTransaction(trx, workspaceId, request, launch, runtime, at),
  );
}

/** The scheduler holds its scoped occurrence row; planner and cadence advancement share that transaction. */
export async function createAuditsInTransaction(
  trx: Database,
  workspaceId: string,
  request: AuditInput,
  launch: AuditLaunch,
  runtime: AuditRuntime,
  at: Date,
): Promise<[string, ...string[]]> {
  const input = auditInput.parse(request);
  const [first, ...rest] = await resolveMarkets(
    trx,
    { workspaceId, projectId: input.project_id },
    input.market_ids,
  );
  if (!first) throw new ApiError(400, 'Select at least one market');
  const launchId = randomUUID();
  const create = (market: Market) =>
    createMarketAudit(trx, workspaceId, input, { market, launchId }, launch, runtime, at);
  const ids: [string, ...string[]] = [await create(first)];
  for (const market of rest) ids.push(await create(market));
  return ids;
}

/** A shell that commits only the complete frozen plan and queue. */
async function createMarketAudit(
  trx: Database,
  workspaceId: string,
  input: AuditInput,
  measured: { market: Market; launchId: string },
  launch: AuditLaunch,
  runtime: AuditRuntime,
  at: Date,
) {
  const trigger = (launch.trigger ?? 'manual').trim().toLowerCase();
  await subjectXactLock(trx, `audit-enqueue:${workspaceId}`);
  if (launch.scheduleId) {
    if (!launch.scheduledFor || trigger !== 'scheduled')
      throw new ApiError(400, 'Scheduled launch requires its occurrence');
    const schedule = await trx
      .selectFrom('audit_schedules')
      .select('id')
      .where('id', '=', launch.scheduleId)
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', input.project_id)
      .executeTakeFirst();
    if (!schedule) throw notFound('Audit schedule');
    const prior = await trx
      .selectFrom('audits')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('project_id', '=', input.project_id)
      .where('schedule_id', '=', launch.scheduleId)
      .where('scheduled_for', '=', launch.scheduledFor)
      .where('market_id', 'is not distinct from', measured.market.id)
      .executeTakeFirst();
    if (prior) return prior.id;
  } else if (launch.scheduledFor)
    throw new ApiError(400, 'Scheduled occurrence requires its schedule');
  const plan = await prepareAudit(
    trx,
    workspaceId,
    input,
    runtime.audits,
    runtime.providers,
    trigger,
    { search: runtime.search, at, selected: measured.market },
  );
  const slots = auditSlots(
    plan.prompts.length,
    plan.routes.map((route) => route.logical_engine),
    plan.repetitions,
    plan.seed,
  );
  await reserveAuditCapacity(trx, workspaceId, slots.length, measured.launchId, runtime, at);
  const id = randomUUID();
  await trx
    .insertInto('audits')
    .values({
      id,
      workspace_id: workspaceId,
      project_id: input.project_id,
      schedule_id: launch.scheduleId ?? null,
      scheduled_for: launch.scheduledFor ?? null,
      status: 'draft',
      trigger,
      benchmark_mode: plan.mode,
      audit_scope: input.audit_scope,
      system_instruction: plan.systemInstruction,
      repetitions: plan.repetitions,
      random_seed: plan.seed,
      configuration: JSON.stringify(plan.configuration),
      requested_count: slots.length,
      completed_count: 0,
      failed_count: 0,
      error_message: '',
      funding_account_id: null,
      funded_budget_period_start: null,
      created_at: at,
      updated_at: at,
      started_at: null,
      completed_at: null,
      analyzer_version: '',
      summary: null,
      parent_audit_id: null,
      repair_key: null,
      market_id: measured.market.id,
      launch_id: measured.launchId,
    })
    .execute();
  const snapshots = await persistSnapshots(trx, id, plan, at);
  const provenance = await persistTasks({
    db: trx,
    scope: { workspaceId, projectId: input.project_id },
    auditId: id,
    plan,
    slots,
    snapshots,
    at,
  });
  await trx
    .updateTable('audits')
    .set({ configuration: JSON.stringify({ ...plan.configuration, ...provenance }) })
    .where('id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .execute();
  await transitionAudit(trx, workspaceId, id, 'validating', at, 'audit validating');
  await transitionAudit(trx, workspaceId, id, 'queued', at, 'audit queued');
  await auditEvent(
    trx,
    id,
    auditPolicy.constants.event_audit_created,
    'audit created',
    { requested_count: slots.length, engines: plan.configuration.engines },
    at,
  );
  await auditEvent(
    trx,
    id,
    auditPolicy.constants.event_audit_queued,
    'audit queued',
    { task_count: slots.length },
    at,
  );
  return id;
}

async function persistSnapshots(db: Database, auditId: string, plan: FrozenAudit, at: Date) {
  const prompts = plan.prompts.map((prompt, index) => ({
    id: randomUUID(),
    audit_id: auditId,
    prompt_id: prompt.id,
    prompt_index: index,
    text: prompt.text,
    theme: prompt.theme,
    intent: prompt.intent,
    buyer_stage: prompt.buyer_stage,
    prompt_intent: prompt.prompt_intent,
    cohort: prompt.cohort,
    generation_evidence: JSON.stringify(prompt.generation_evidence),
    created_at: at,
  }));
  const engines = plan.routes.map((route) => ({
    id: randomUUID(),
    audit_id: auditId,
    ...route,
    created_at: at,
  }));
  await db.insertInto('audit_prompt_snapshots').values(prompts).execute();
  await db.insertInto('audit_engine_snapshots').values(engines).execute();
  return { prompts, engines: new Map(engines.map((row) => [row.logical_engine, row])) };
}
function frozenSearch(plan: FrozenAudit, engine: Engine) {
  if (!['google_ai_overview', 'chatgpt_search', 'gemini_consumer'].includes(engine)) return null;
  const scraper = engine === 'chatgpt_search' || engine === 'gemini_consumer';
  return {
    timeout_seconds: plan.searchTimeoutSeconds,
    location_code: plan.project.serp_location_code,
    language_code: plan.project.serp_language_code || searchPolicy.constants.default_language_code,
    device: plan.project.serp_device || searchPolicy.constants.default_device,
    ...(scraper
      ? {
          provider_product: searchPolicy.scraper.products[engine],
          request_settings: searchPolicy.scraper.request_settings[engine],
          recovery_deadline_hours: plan.recoveryDeadlineHours,
        }
      : {}),
  };
}
async function persistTasks(options: {
  db: Database;
  scope: AuditScope;
  auditId: string;
  plan: FrozenAudit;
  at: Date;
  slots: ReturnType<typeof auditSlots>;
  snapshots: Awaited<ReturnType<typeof persistSnapshots>>;
}) {
  const { db, scope, auditId, plan, slots, snapshots, at } = options;
  const taskCredentials: Record<string, unknown> = {};
  const engineRoutes = { ...plan.configuration.engine_routes };
  const inserted = [];
  for (const [position, slot] of slots.entries()) {
    const route = plan.routes.find((row) => row.logical_engine === slot.engine)!;
    const prompt = snapshots.prompts[slot.prompt]!,
      engine = snapshots.engines.get(slot.engine)!;
    const taskId = randomUUID();
    inserted.push({ taskId, slot, route, engine });
    await db
      .insertInto('audit_tasks')
      .values({
        id: taskId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        audit_id: auditId,
        prompt_snapshot_id: prompt.id,
        engine_snapshot_id: engine.id,
        prompt_index: slot.prompt,
        repetition: slot.repetition,
        randomized_position: position,
        logical_engine: slot.engine,
        transport_provider: route.transport_provider,
        transport_model: route.transport_model,
        prompt_text: prompt.text,
        idempotency_key: `${auditId}:${slot.prompt}:${slot.repetition}:${slot.engine}`,
        max_attempts: plan.measurement.max_attempts,
        status: 'pending_reservation',
        available_at: at,
        priority: 0,
        attempt_count: 0,
        completed_at: null,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        answer_text: '',
        error_code: '',
        error_detail: '',
        latency_ms: null,
        provider_metadata: null,
        search_used: false,
        search_events: null,
        citations: null,
        request_snapshot: JSON.stringify({
          ...frozenSearch(plan, slot.engine),
          original_prompt_id: plan.prompts[slot.prompt]!.id,
        }),
        provider_route_snapshot: null,
        provider_submission_ref: '',
        provider_task_id: '',
        provider_task_submitted_at: null,
        provider_poll_count: 0,
        provider_connection_id: null,
        provider_credential_revision: null,
        finish_reason: 'unknown',
        raw_finish_reason: null,
        result_artifact_id: null,
        score: null,
        source_task_id: null,
        created_at: at,
        updated_at: at,
      })
      .execute();
  }
  for (const { taskId, slot, route, engine } of inserted) {
    const binding = bindTask(plan, route);
    await db
      .updateTable('audit_tasks')
      .set({ status: 'queued', provider_route_snapshot: JSON.stringify(binding) })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', taskId)
      .execute();
    await db
      .updateTable('audit_engine_snapshots')
      .set({ connection_id: binding.connection_id, base_url: binding.base_url })
      .where('id', '=', engine.id)
      .where('audit_id', '=', auditId)
      .execute();
    taskCredentials[taskId] = {
      credential_source: binding.credential_source,
      connection_id: binding.connection_id,
    };
    // The frozen route also carries its credential source for execution.
    engineRoutes[slot.engine] = {
      ...route,
      ...auditPolicy.route_policies[slot.engine],
      connection_id: binding.connection_id,
      base_url: binding.base_url,
      credential_source: binding.credential_source,
    };
  }
  return { engine_routes: engineRoutes, task_credentials: taskCredentials };
}

/** The task's frozen provider route: the workspace's own connection for its engine. */
function bindTask(plan: FrozenAudit, route: FrozenAudit['routes'][number]) {
  return {
    ...route,
    credential_source: 'byok',
    reservation_id: null,
    ...auditPolicy.route_policies[route.logical_engine],
    ...plan.measurement,
  };
}
