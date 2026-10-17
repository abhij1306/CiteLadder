import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createAudits } from '../src/audits/creation.ts';
import { AuditQueue } from '../src/queue/audit-queue.ts';
import { createConnection } from '../src/providers/connections.ts';
import { createConnectionInput } from '../src/providers/inputs.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { loadExecutionContext } from '../src/audits/execution-context.ts';
import { commitSubmissionIntent } from '../src/audits/submission-intent.ts';
import { persistOverview, persistSurfaceExchange } from '../src/audits/surface-persistence.ts';
import { parseOverview } from '../src/search-surfaces/parsing.ts';
import { record } from '../src/db/json.ts';
const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({}),
  queue = new AuditQueue(db, 120),
  tasks: string[] = [];
afterEach(async () => {
  if (tasks.length) {
    await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
    await db.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute();
  }
  await fixtures.cleanup();
  tasks.length = 0;
});
afterAll(async () => {
  await db.destroy();
});
async function seed() {
  const t = await auditTenant(db, fixtures);
  const connection = await createConnection(
    db,
    t.workspaceId,
    t.userId,
    createConnectionInput.parse({
      transport_provider: 'dataforseo',
      api_login: 'test@example.com',
      api_password: 'test',
      routes: [{ logical_engine: 'google_ai_overview' }],
    }),
    auditTestKey,
    runtime.providers,
  );
  await probeConnection(
    db,
    t.workspaceId,
    connection.id,
    auditTestKey,
    runtime.providers,
    async () => ({ status: 200, body: { status_code: 20000, tasks: [] } }),
  );
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({
      project_id: t.projectId,
      prompt_set_id: t.setId,
      engines: ['google_ai_overview'],
    }),
    {},
    runtime,
  );
  const [task] = await queue.claim('worker', 1, { workspaceId: t.workspaceId, auditId });
  await queue.markRunning(task!, 'worker');
  tasks.push(task!.id);
  const context = await loadExecutionContext(
    db,
    task!,
    'worker',
    runtime,
    auditTestKey,
    new Date(),
  );
  const intent = await commitSubmissionIntent(db, context!, 'worker');
  return { ...t, task: intent!.task };
}
describe('durable surface evidence', () => {
  it('preserves the submission charge through a pending park and an atomic terminal observation', async () => {
    const t = await seed();
    await persistSurfaceExchange(db, t.task, 'worker', {
      taskId: 'provider-id',
      chargeMicrousd: 1800,
      paid: true,
      delaySeconds: 0,
    });
    // Lease the same persisted phase; no second paid submission occurs.
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'worker',
        lease_expires_at: new Date(Date.now() + 120000),
      })
      .where('id', '=', t.task.id)
      .execute();
    await persistSurfaceExchange(db, t.task, 'worker', { poll: true, delaySeconds: 0 });
    const parked = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(parked).toMatchObject({
      status: 'awaiting_provider_result',
      attempt_count: 1,
      provider_poll_count: 1,
    });
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'running',
        lease_owner: 'worker',
        lease_expires_at: new Date(Date.now() + 120000),
      })
      .where('id', '=', t.task.id)
      .execute();
    const result = parseOverview(
      {
        status_code: 20000,
        tasks: [
          {
            id: 'provider-id',
            status_code: 20000,
            cost: 0,
            result: [
              {
                items: [
                  {
                    type: 'ai_overview',
                    items: [
                      {
                        type: 'ai_overview_element',
                        text: 'Acme Running shoes',
                        links: [{ url: 'https://acme.example/shoes' }],
                      },
                    ],
                    references: [{ url: 'https://publisher.example/guide' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      'provider-id',
    );
    if (typeof result === 'string') throw new Error('Expected observation');
    await persistOverview(db, t.task, 'worker', result, runtime);
    expect(await persistOverview(db, t.task, 'worker', result, runtime)).toBeNull();
    const artifact = await db
      .selectFrom('raw_response_artifacts')
      .selectAll()
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(record(artifact.usage).provider_cost_microusd).toBe(1800);
    const observation = await db
      .selectFrom('aio_observations')
      .selectAll()
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(observation).toMatchObject({
      outcome: 'ai_overview_present',
      reference_count: 1,
      element_count: 1,
      provider_task_id: 'provider-id',
    });
    expect(
      (
        await db
          .selectFrom('aio_entity_links')
          .select('url')
          .where('observation_id', '=', observation.id)
          .execute()
      ).map((row) => row.url),
    ).toEqual(['https://acme.example/shoes']);
    expect(
      (
        await db
          .selectFrom('citations')
          .select('url')
          .where('artifact_id', '=', artifact.id)
          .execute()
      ).map((row) => row.url),
    ).toEqual(['https://publisher.example/guide']);
    const projection = await db
      .selectFrom('execution_cost_projections')
      .selectAll()
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(projection).toMatchObject({ provider_reported_cost_microusd: '1800', attempt_count: 3 });
  });
  it('records a parser failure as unavailable, retaining paid submission evidence without a successful raw artifact', async () => {
    const t = await seed();
    const result = parseOverview(
      {
        status_code: 20000,
        tasks: [
          { id: 'provider-id', status_code: 20000, result: [{ items: { unexpected: true } }] },
        ],
      },
      'provider-id',
    );
    if (typeof result === 'string') throw new Error('Expected failure');
    await persistOverview(db, t.task, 'worker', result, runtime);
    expect(
      await db
        .selectFrom('aio_observations')
        .selectAll()
        .where('task_id', '=', t.task.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ outcome: 'parser_error', aio_present: null });
    expect(
      await db
        .selectFrom('raw_response_artifacts')
        .select('id')
        .where('task_id', '=', t.task.id)
        .execute(),
    ).toHaveLength(0);
    expect(
      (
        await db
          .selectFrom('audit_tasks')
          .select('status')
          .where('id', '=', t.task.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('failed');
  });
});
