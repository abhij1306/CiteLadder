import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createAudits } from '../src/audits/creation.ts';
import {
  auditEvents,
  listAudits,
  listExecutions,
  readAudit,
  readAuditMetrics,
} from '../src/audits/reads.ts';
import { auditPerformance } from '../src/audits/performance.ts';
import { createRepairAudit, repairInput } from '../src/audits/repair.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({});
afterEach(async () => {
  await fixtures.cleanup();
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
  return { ...t, auditId, tasks };
}
describe('persisted audit reads and immutable repair', () => {
  it('scopes reads, lists executions without their answers, and keeps unavailable metrics and timings distinct', async () => {
    const t = await seed(),
      foreign = await seed();
    await expect(readAudit(db, foreign.workspaceId, t.auditId)).rejects.toMatchObject({
      status: 404,
    });
    const run = await readAudit(db, t.workspaceId, t.auditId);
    expect(run.model_provenance).toMatchObject([
      { logical_engine: 'chatgpt', retrieval_enabled: true },
    ]);
    expect(run).not.toHaveProperty('configuration');
    expect(await listAudits(db, t.workspaceId, foreign.projectId)).toEqual([]);
    await expect(readAuditMetrics(db, t.workspaceId, t.auditId)).rejects.toMatchObject({
      status: 404,
    });
    const task = t.tasks[0]!;
    await db
      .updateTable('audit_tasks')
      .set({
        provider_metadata: JSON.stringify({ search_surface_outcome: 'aio_present_no_text' }),
        answer_text: 'Acme is the plumber to call.',
        status: 'capacity_wait',
        latency_ms: 812,
      })
      .where('id', '=', task.id)
      .execute();
    const executions = await listExecutions(db, t.workspaceId, t.auditId);
    // The list carries the table's columns only: the answer, snapshots and
    // provider metadata stay on the single-execution read.
    expect(executions[0]).toEqual({
      id: task.id,
      prompt_index: task.prompt_index,
      logical_engine: 'chatgpt',
      transport_provider: task.transport_provider,
      status: 'capacity_wait',
      prompt_text: task.prompt_text,
      error_code: '',
      latency_ms: 812,
    });
    await expect(listExecutions(db, foreign.workspaceId, t.auditId)).rejects.toMatchObject({
      status: 404,
    });
    expect(await auditPerformance(db, t.workspaceId, t.auditId)).toMatchObject({
      queue_wait_ms: null,
      total_run_duration_ms: null,
      time_to_first_result_ms: null,
      usage: { input_tokens: null, output_tokens: null, total_tokens: null },
      projected_cost_microusd: null,
      coverage: 0,
    });
  });
  it('offers a cancel while the run executes and withdraws it once reporting starts', async () => {
    const t = await seed();
    const cancelableAt = async (status: 'running' | 'reporting' | 'completed') => {
      await db.updateTable('audits').set({ status }).where('id', '=', t.auditId).execute();
      return (await readAudit(db, t.workspaceId, t.auditId)).cancelable;
    };
    expect([
      await cancelableAt('running'),
      await cancelableAt('reporting'),
      await cancelableAt('completed'),
    ]).toEqual([true, false, false]);
  });
  it('resumes events at exact microsecond and UUID order and rejects foreign cursors', async () => {
    const t = await seed(),
      foreign = await seed();
    await db.deleteFrom('audit_events').where('audit_id', '=', t.auditId).execute();
    const eventIds = [randomUUID(), randomUUID()].sort();
    for (const [index, id] of [...eventIds, randomUUID()].entries())
      await db
        .insertInto('audit_events')
        .values({
          id,
          workspace_id: t.workspaceId,
          audit_id: t.auditId,
          event_type: index === 0 ? 'audit.running' : 'audit.status',
          message: '',
          payload: index === 0 ? null : JSON.stringify({ status: 'running' }),
          created_at: sql<Date>`${index < 2 ? '2026-01-01T00:00:00.000001Z' : '2026-01-01T00:00:00.000002Z'}::timestamptz`,
        })
        .execute();
    const first = await auditEvents(db, t.workspaceId, t.auditId, undefined, 1);
    expect(first).toMatchObject([
      { id: eventIds[0], payload: null, occurred_at: '2026-01-01T00:00:00.000001Z' },
    ]);
    const tail = await auditEvents(db, t.workspaceId, t.auditId, first[0]!.id, 10);
    expect(tail.map((event) => event.occurred_at)).toEqual([
      '2026-01-01T00:00:00.000001Z',
      '2026-01-01T00:00:00.000002Z',
    ]);
    const other = await auditEvents(db, foreign.workspaceId, foreign.auditId, undefined, 1);
    await expect(auditEvents(db, t.workspaceId, t.auditId, other[0]!.id, 10)).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(
      auditEvents(db, foreign.workspaceId, t.auditId, undefined, 10),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('clones only selected failed slots once and preserves frozen context', async () => {
    const t = await seed(),
      foreign = await seed();
    await db
      .updateTable('audits')
      .set({ status: 'partially_completed', completed_at: new Date() })
      .where('id', '=', t.auditId)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'failed',
        error_code: 'timeout',
        attempt_count: 2,
        provider_submission_ref: 'old-paid-intent',
        provider_task_id: 'old-receipt',
      })
      .where('audit_id', '=', t.auditId)
      .execute();
    const request = repairInput.parse({ task_ids: [t.tasks[0]!.id] });
    await expect(
      createRepairAudit(db, foreign.workspaceId, t.auditId, request, runtime),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createRepairAudit(
        db,
        t.workspaceId,
        t.auditId,
        repairInput.parse({ task_ids: [foreign.tasks[0]!.id] }),
        runtime,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const repaired = await Promise.all([
      createRepairAudit(db, t.workspaceId, t.auditId, request, runtime),
      createRepairAudit(db, t.workspaceId, t.auditId, request, runtime),
    ]);
    expect(new Set(repaired.map((result) => result.auditId)).size).toBe(1);
    expect(repaired.filter((result) => result.created)).toHaveLength(1);
    const child = await readAudit(db, t.workspaceId, repaired[0]!.auditId);
    expect(child).toMatchObject({
      parent_audit_id: t.auditId,
      requested_count: 1,
      status: 'queued',
    });
    const cloned = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('audit_id', '=', child.id)
      .executeTakeFirstOrThrow();
    expect(cloned).toMatchObject({
      source_task_id: t.tasks[0]!.id,
      request_snapshot: t.tasks[0]!.request_snapshot,
      provider_route_snapshot: t.tasks[0]!.provider_route_snapshot,
      attempt_count: 0,
      provider_submission_ref: '',
      provider_task_id: '',
      result_artifact_id: null,
    });
    // The default selection (every failed task) overlaps the live child's task.
    await expect(
      createRepairAudit(db, t.workspaceId, t.auditId, repairInput.parse({}), runtime),
    ).rejects.toMatchObject({
      status: 409,
      message: 'A running repair already covers a selected task',
    });
  });
});
