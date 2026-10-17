import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createAudits } from '../src/audits/creation.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { record } from '../src/db/json.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import providers from '../src/config/providers.json' with { type: 'json' };

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const runtime = auditRuntime({});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
function input(t: Awaited<ReturnType<typeof auditTenant>>) {
  return auditInput.parse({
    project_id: t.projectId,
    prompt_set_id: t.setId,
    engines: ['chatgpt'],
    random_seed: '42',
  });
}
async function queued(workspaceId: string) {
  return db.selectFrom('audits').selectAll().where('workspace_id', '=', workspaceId).execute();
}
describe('atomic audit admission', () => {
  it('rejects unshipped catalog engines before persisting an audit', async () => {
    const t = await auditTenant(db, fixtures);
    vi.resetModules();
    vi.doMock('../src/config/providers.json', () => ({
      default: {
        ...providers,
        catalog: providers.catalog.map((row) =>
          row.key === 'chatgpt' ? { ...row, adapter_shipped: false } : row,
        ),
      },
    }));
    try {
      const { createAudits: createWithoutAdapter } = await import('../src/audits/creation.ts');
      const { scheduleCreate } = await import('../src/audits/schedule-inputs.ts');
      await expect(
        createWithoutAdapter(db, t.workspaceId, input(t), {}, runtime),
      ).rejects.toMatchObject({ status: 400, message: 'An engine is unavailable' });
      expect(
        scheduleCreate.safeParse({ prompt_set_id: t.setId, cadence: 'daily', engines: ['chatgpt'] })
          .success,
      ).toBe(false);
    } finally {
      vi.doUnmock('../src/config/providers.json');
      vi.resetModules();
    }
    expect(await queued(t.workspaceId)).toEqual([]);
  });
  it.each([
    'AUDIT_WORKER_CONCURRENCY',
    'AUDIT_POLL_INTERVAL_SECONDS',
    'AUDIT_LEASE_TTL_SECONDS',
    'AUDIT_MAX_ATTEMPTS',
  ])('refuses zero execution bound %s', (name) => {
    expect(() => auditRuntime({ [name]: '0' })).toThrow();
  });
  it('permits disabled pacing and jitter while refusing inconsistent heartbeat and retry bounds', () => {
    expect(
      auditRuntime({ AUDIT_MIN_REQUEST_INTERVAL_SECONDS: '0', AUDIT_RETRY_JITTER_SECONDS: '0' })
        .audits.retry_jitter_seconds,
    ).toBe(0);
    expect(() => auditRuntime({ AUDIT_HEARTBEAT_INTERVAL_SECONDS: '120' })).toThrow('heartbeat');
    expect(() => auditRuntime({ AUDIT_RETRY_BASE_DELAY_SECONDS: '46' })).toThrow('retry');
  });
  it('persists replayable slots, immutable snapshots, credential identity and queue events together', async () => {
    const t = await auditTenant(db, fixtures);
    const [id] = await createAudits(db, t.workspaceId, input(t), {}, runtime);
    const audit = (await queued(t.workspaceId))[0]!;
    expect(audit).toMatchObject({
      id,
      status: 'queued',
      requested_count: 3,
      random_seed: '42',
      funding_account_id: null,
    });
    const tasks = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('audit_id', '=', id)
      .orderBy('randomized_position')
      .execute();
    expect(new Set(tasks.map((task) => task.repetition)).size).toBe(3);
    expect(tasks.every((task) => task.status === 'queued' && task.attempt_count === 0)).toBe(true);
    expect(record(tasks[0]?.provider_route_snapshot)).toMatchObject({
      credential_source: 'byok',
      connection_id: t.connectionId,
      reservation_id: null,
      retrieval_enabled: true,
    });
    await db
      .updateTable('prompts')
      .set({ text: 'Changed later' })
      .where('id', '=', t.promptId)
      .execute();
    const snapshot = await db
      .selectFrom('audit_prompt_snapshots')
      .select('text')
      .where('audit_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(snapshot.text).toBe('Which running shoes suit road use?');
    const events = await db
      .selectFrom('audit_events')
      .select(['event_type', 'payload'])
      .where('audit_id', '=', id)
      .execute();
    expect(
      events
        .filter((event) => event.event_type === 'audit.status')
        .map((event) => record(event.payload).status)
        .sort(),
    ).toEqual(['queued', 'validating']);
  });
  it('serializes concurrent launches at the workspace capacity boundary', async () => {
    const t = await auditTenant(db, fixtures);
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        createAudits(db, t.workspaceId, input(t), {}, { ...runtime, activeLimit: 1 }),
      ),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 429 },
    });
    expect(await queued(t.workspaceId)).toHaveLength(1);
    const windows = await db
      .selectFrom('usage_windows')
      .select('count')
      .where('operation', '=', 'audit.provider_tasks')
      .where('subject_hash', '=', createHash('sha256').update(t.workspaceId).digest('hex'))
      .execute();
    expect(windows[0]?.count).toBe(3);
  });
  it('rejects a foreign project before consuming admission capacity', async () => {
    const t = await auditTenant(db, fixtures),
      foreign = await auditTenant(db, fixtures);
    await expect(
      createAudits(db, foreign.workspaceId, input(t), {}, runtime),
    ).rejects.toMatchObject({ status: 404 });
    expect(await queued(foreign.workspaceId)).toEqual([]);
  });
});
