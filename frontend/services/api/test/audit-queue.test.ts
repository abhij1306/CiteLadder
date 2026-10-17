import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AuditQueue, ownedAuditTask, parkAuditTask } from '../src/queue/audit-queue.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { transitionAudit } from '../src/audits/state.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const runtime = auditRuntime({});
let at = new Date();
const queue = new AuditQueue(db, 120, () => at);
afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});
async function seed() {
  const t = await auditTenant(db, fixtures);
  at = new Date();
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
    {},
    runtime,
    at,
  );
  return { ...t, auditId };
}
describe('audit queue leases against PostgreSQL', () => {
  it('keeps a lease live when the application clock is a day behind PostgreSQL', async () => {
    const t = await seed();
    const [task] = await queue.claim('skewed', 1, t);
    at = new Date(Date.now() - 86400000);
    const skewed = new AuditQueue(db, 120, () => at);
    expect(await skewed.heartbeat(task!, 'skewed')).toBe(true);
    expect(await skewed.markRunning(task!, 'skewed')).not.toBeNull();
  });
  it('refuses lifecycle jumps and terminal revival without writing an event', async () => {
    const t = await seed();
    const transition = (target: string) =>
      db.transaction().execute((trx) => transitionAudit(trx, t.workspaceId, t.auditId, target, at));
    const events = () =>
      db.selectFrom('audit_events').select('id').where('audit_id', '=', t.auditId).execute();
    const before = await events();
    await expect(transition('completed')).rejects.toMatchObject({ status: 409 });
    await transition('queued');
    expect(await events()).toHaveLength(before.length);
    await transition('running');
    await transition('partially_completed');
    await expect(transition('running')).rejects.toMatchObject({ status: 409 });
    expect(await events()).toHaveLength(before.length + 2);
    expect(
      await db.selectFrom('audits').select('status').where('id', '=', t.auditId).executeTakeFirst(),
    ).toEqual({ status: 'partially_completed' });
  });
  it('gives each workspace a turn and concurrent claims never share a task', async () => {
    const one = await seed(),
      two = await seed(),
      foreign = await seed();
    const scopes = [one, two].map(({ workspaceId, auditId }) => ({ workspaceId, auditId }));
    const fair = await queue.claim('fair', 2, scopes);
    expect(new Set(fair.map((task) => task.workspace_id))).toEqual(
      new Set([one.workspaceId, two.workspaceId]),
    );
    const claimed = (
      await Promise.all(['worker-a', 'worker-b'].map((owner) => queue.claim(owner, 3, scopes)))
    ).flat();
    expect(claimed).toHaveLength(4);
    expect(new Set([...fair, ...claimed].map((task) => task.id)).size).toBe(6);
    const foreignTasks = await db
      .selectFrom('audit_tasks')
      .select('status')
      .where('workspace_id', '=', foreign.workspaceId)
      .where('audit_id', '=', foreign.auditId)
      .execute();
    expect(foreignTasks.map((task) => task.status)).toEqual(['queued', 'queued', 'queued']);
  });
  it('rejects another owner, an expired lease and a cancelled parent before execution', async () => {
    const t = await seed();
    const [task] = await queue.claim('worker', 1, t);
    expect(await queue.markRunning(task!, 'other')).toBeNull();
    expect(await queue.heartbeat(task!, 'other')).toBe(false);
    const running = await queue.markRunning(task!, 'worker');
    expect(running?.audit.status).toBe('running');
    // Expiry belongs to PostgreSQL, independent of the injected application clock.
    await db
      .updateTable('audit_tasks')
      .set({ lease_expires_at: new Date(0) })
      .where('id', '=', task!.id)
      .execute();
    expect(await queue.heartbeat(task!, 'worker')).toBe(false);
    expect(await queue.markRunning(task!, 'worker')).toBeNull();
    const [another] = await queue.claim('worker', 1, t);
    await db
      .updateTable('audits')
      .set({ status: 'cancelled' })
      .where('id', '=', t.auditId)
      .execute();
    expect(await queue.markRunning(another!, 'worker')).toBeNull();
  });
  it('parks a committed external submission and reclaims its due poll without spending an attempt', async () => {
    const t = await seed();
    const [task] = await queue.claim('worker', 1, t);
    const ready = new Date(at.getTime() + 30000);
    await db.transaction().execute(async (trx) => {
      const locked = await ownedAuditTask(trx, task!, 'worker');
      expect(locked).not.toBeNull();
      await trx
        .updateTable('audit_tasks')
        .set({
          provider_submission_ref: 'intent-tag',
          provider_task_id: 'paid-task',
          provider_task_submitted_at: at,
        })
        .where('id', '=', task!.id)
        .execute();
      await parkAuditTask(trx, locked!.task, 'awaiting_provider_result', ready, at);
    });
    await queue.claim('drain', 3, t); // Other ready slots may progress while this task waits.
    expect(await queue.claim('poller', 1, t)).toEqual([]);
    at = ready;
    const [poll] = await queue.claim('poller', 1, t);
    expect(poll).toMatchObject({
      id: task!.id,
      provider_task_id: 'paid-task',
      provider_submission_ref: 'intent-tag',
      attempt_count: 0,
    });
  });
  it('reports the earliest claimable time so an idle runner waits for a due retry, not terminal tasks', async () => {
    const t = await seed();
    const scoped = (status: string, availableAt: Date) =>
      db
        .updateTable('audit_tasks')
        .set({ status, available_at: availableAt })
        .where('audit_id', '=', t.auditId)
        .execute();
    await scoped('succeeded', new Date(0));
    const none = await queue.nextDue();
    if (none) expect(none.getTime()).toBeGreaterThan(0); // other tenants may hold work
    const [task] = await db
      .selectFrom('audit_tasks')
      .select('id')
      .where('audit_id', '=', t.auditId)
      .execute();
    const soon = new Date(Date.now() + 5000);
    await db
      .updateTable('audit_tasks')
      .set({ status: 'retry_wait', available_at: soon })
      .where('id', '=', task!.id)
      .execute();
    const due = await queue.nextDue();
    expect(due!.getTime()).toBeLessThanOrEqual(soon.getTime());
    expect(due!.getTime()).toBeGreaterThan(0);
  });
});
