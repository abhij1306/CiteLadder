import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createAudits } from '../src/audits/creation.ts';
import { AuditMaintenance, cancelAudit, repairOwnedCompletion } from '../src/audits/maintenance.ts';
import { auditProjections } from '../src/audits/projections.ts';
import { analyzeExecution } from '../src/analysis/execution.ts';
import { persistExecutionSuccess, type ExecutionResult } from '../src/audits/result-persistence.ts';
import type { AuditTask } from '../src/queue/audit-queue.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({});
const taskIds: string[] = [];
it('continues recovery for other audits when one persisted parent cannot finalize', async () => {
  const first = await seed(),
    second = await seed();
  for (const t of [first, second])
    await db
      .updateTable('audit_tasks')
      .set({ status: 'failed', completed_at: new Date() })
      .where('audit_id', '=', t.auditId)
      .where('workspace_id', '=', t.workspaceId)
      .execute();
  const visited: string[] = [];
  await new AuditMaintenance(db, async (_workspace, id) => {
    visited.push(id);
    if (id === first.auditId) throw new Error('Broken projection fixture');
  }).runOnce();
  expect(visited).toContain(first.auditId);
  expect(visited).toContain(second.auditId);
});
afterEach(async () => {
  if (taskIds.length) {
    await db.deleteFrom('execution_cost_projections').where('task_id', 'in', taskIds).execute();
    await db.deleteFrom('provider_attempts').where('task_id', 'in', taskIds).execute();
  }
  await fixtures.cleanup();
  taskIds.length = 0;
});
afterAll(async () => {
  await db.destroy();
});
async function seed() {
  const t = await auditTenant(db, fixtures);
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
    {},
    runtime,
  );
  const tasks = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .where('workspace_id', '=', t.workspaceId)
    .where('audit_id', '=', auditId)
    .orderBy('randomized_position')
    .execute();
  taskIds.push(...tasks.map((task) => task.id));
  return { ...t, auditId, tasks };
}
function answer(task: AuditTask): ExecutionResult {
  return {
    logical_engine: 'chatgpt',
    transport_provider: 'openai',
    transport_model: task.transport_model,
    answer_text: 'Acme Running is recommended.',
    search_used: false,
    search_events: [],
    citations: [],
    retrieved_sources: [],
    finish_reason: 'stop',
    raw_finish_reason: 'stop',
    latency_ms: 1,
    provider_metadata: {},
    normalized_usage: {
      uncached_input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      total_tokens: null,
      web_search_requests: null,
      provider_cost_microusd: null,
    },
  };
}
describe('audit recovery against PostgreSQL', () => {
  it('uses database time to recover leases despite application clock skew', async () => {
    const t = await seed(),
      task = t.tasks[0]!;
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'worker',
        lease_expires_at: sql<Date>`clock_timestamp() + interval '120 seconds'`,
      })
      .where('id', '=', task.id)
      .execute();
    const maintenance = new AuditMaintenance(db, async () => {});
    expect(await maintenance.runOnce(new Date(Date.now() + 86_400_000))).toBe(0);
    await db
      .updateTable('audit_tasks')
      .set({
        lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
      })
      .where('id', '=', task.id)
      .execute();
    expect(await maintenance.runOnce(new Date(Date.now() - 86_400_000))).toBe(1);
    expect(
      await db
        .selectFrom('audit_tasks')
        .select(['status', 'attempt_count'])
        .where('id', '=', task.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      status: 'retry_wait',
      attempt_count: 1,
    });
  });
  it('reclaims each expired lease once and diverts paid uncertainty', async () => {
    const t = await seed();
    await seed();
    const at = new Date();
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'dead-worker',
        lease_expires_at: new Date(at.getTime() - 1000),
      })
      .where('audit_id', '=', t.auditId)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({ provider_submission_ref: 'committed-intent', attempt_count: 3 })
      .where('id', '=', t.tasks[1]!.id)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({ attempt_count: t.tasks[2]!.max_attempts - 1, provider_route_snapshot: '{}' })
      .where('id', '=', t.tasks[2]!.id)
      .execute();
    const parents: string[] = [],
      maintenance = new AuditMaintenance(db, async (_workspace, auditId) => {
        parents.push(auditId);
      });
    const reclaimed = await Promise.all([maintenance.runOnce(at), maintenance.runOnce(at)]);
    // Concurrent SKIP LOCKED passes may defer a sibling task while its audit is locked.
    reclaimed.push(await maintenance.runOnce(at));
    expect(reclaimed.reduce((a, b) => a + b, 0)).toBe(3);
    const tasks = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('audit_id', '=', t.auditId)
      .execute();
    expect(tasks.find((row) => row.id === t.tasks[0]!.id)).toMatchObject({
      status: 'retry_wait',
      attempt_count: 1,
      lease_owner: null,
    });
    expect(tasks.find((row) => row.id === t.tasks[1]!.id)).toMatchObject({
      status: 'submission_uncertain',
      attempt_count: 3,
    });
    expect(tasks.find((row) => row.id === t.tasks[2]!.id)).toMatchObject({ status: 'failed' });
    expect(parents).toContain(t.auditId);
    expect(await maintenance.runOnce(at)).toBe(0);
  });
  it('cancels all open tasks atomically and rejects stale evidence', async () => {
    const t = await seed(),
      foreign = await seed(),
      task = t.tasks[0]!;
    await expect(cancelAudit(db, foreign.workspaceId, t.auditId)).rejects.toMatchObject({
      status: 404,
    });
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'worker',
        lease_expires_at: new Date(Date.now() + 120000),
      })
      .where('id', '=', task.id)
      .execute();
    await cancelAudit(db, t.workspaceId, t.auditId);
    expect(
      await persistExecutionSuccess(db, task, 'worker', answer(task), analyzeExecution),
    ).toBeNull();
    expect(
      (
        await db
          .selectFrom('audit_tasks')
          .select('status')
          .where('audit_id', '=', t.auditId)
          .execute()
      ).every((row) => row.status === 'cancelled'),
    ).toBe(true);
  });
  it('repairs an artifact committed ahead of its queue transition without repeating evidence, then queues source inspection once after terminal commit', async () => {
    const t = await seed(),
      task = t.tasks[0]!;
    const at = new Date();
    await db
      .updateTable('audits')
      .set({ status: 'running', started_at: at })
      .where('id', '=', t.auditId)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'worker',
        lease_expires_at: new Date(at.getTime() + 120000),
      })
      .where('id', '=', task.id)
      .execute();
    const artifactId = await persistExecutionSuccess(
      db,
      task,
      'worker',
      answer(task),
      analyzeExecution,
      { at },
    );
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'repair',
        lease_expires_at: new Date(at.getTime() + 120000),
      })
      .where('id', '=', task.id)
      .execute();
    expect(await repairOwnedCompletion(db, task, 'repair', at)).toBe(true);
    expect(await repairOwnedCompletion(db, task, 'repair', at)).toBe(false);
    expect(
      await db
        .selectFrom('raw_response_artifacts')
        .select('id')
        .where('task_id', '=', task.id)
        .execute(),
    ).toEqual([{ id: artifactId }]);
    expect(
      await db
        .selectFrom('provider_attempts')
        .select('id')
        .where('task_id', '=', task.id)
        .execute(),
    ).toHaveLength(1);
    await db
      .updateTable('audit_tasks')
      .set({ status: 'failed', completed_at: at })
      .where('audit_id', '=', t.auditId)
      .where('id', '!=', task.id)
      .execute();
    const projections = auditProjections(db, null, {});
    await projections.finalize(t.workspaceId, t.auditId);
    await projections.finalize(t.workspaceId, t.auditId);
    const inspection = await db
      .selectFrom('analytics_tasks')
      .select(['task_kind', 'payload'])
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', 'source_page_inspection')
      .execute();
    expect(inspection).toEqual([
      { task_kind: 'source_page_inspection', payload: { audit_id: t.auditId } },
    ]);
  });
});
