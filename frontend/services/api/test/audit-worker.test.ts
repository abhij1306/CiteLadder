import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { AuditWorker } from '../src/workers/audit-worker.ts';
import { analyzeExecution } from '../src/analysis/execution.ts';
import { finalizeAudit } from '../src/analysis/finalization.ts';
import { createConnection } from '../src/providers/connections.ts';
import { createConnectionInput } from '../src/providers/inputs.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { record } from '../src/db/json.ts';
const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  base = auditRuntime({});
const runtime = { ...base, audits: { ...base.audits, worker_concurrency: 1 } };
const workspaces: string[] = [],
  tasks: string[] = [];
afterEach(async () => {
  if (tasks.length) {
    await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
    await db.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute();
  }
  if (workspaces.length)
    await db
      .deleteFrom('provider_capacity_buckets')
      .where(
        'connection_id',
        'in',
        db.selectFrom('provider_connections').select('id').where('workspace_id', 'in', workspaces),
      )
      .execute();
  await fixtures.cleanup();
  tasks.length = 0;
  workspaces.length = 0;
});
afterAll(async () => {
  await db.destroy();
});
async function seed(surface = false) {
  const t = await auditTenant(db, fixtures);
  workspaces.push(t.workspaceId);
  if (surface) {
    const c = await createConnection(
      db,
      t.workspaceId,
      t.userId,
      createConnectionInput.parse({
        transport_provider: 'dataforseo',
        api_login: 'worker@example.com',
        api_password: 'test',
        routes: [{ logical_engine: 'chatgpt_search' }],
      }),
      auditTestKey,
      runtime.providers,
    );
    await probeConnection(db, t.workspaceId, c.id, auditTestKey, runtime.providers, async () => ({
      status: 200,
      body: { status_code: 20000, tasks: [] },
    }));
  }
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({
      project_id: t.projectId,
      prompt_set_id: t.setId,
      engines: [surface ? 'chatgpt_search' : 'chatgpt'],
    }),
    {},
    runtime,
  );
  const all = await db
    .selectFrom('audit_tasks')
    .selectAll()
    .where('audit_id', '=', auditId)
    .orderBy('randomized_position')
    .execute();
  tasks.push(...all.map((task) => task.id));
  await db
    .updateTable('audit_tasks')
    .set({ available_at: new Date(Date.now() + 3600000) })
    .where('audit_id', '=', auditId)
    .where('id', '!=', all[0]!.id)
    .execute();
  return { ...t, auditId, task: all[0]! };
}
function worker(
  scope: { workspaceId: string; auditId: string },
  send: typeof fetch,
  settings = runtime,
  now?: () => Date,
) {
  return new AuditWorker(
    db,
    settings,
    auditTestKey,
    {
      execution: analyzeExecution,
      finalize: (workspaceId, auditId) => finalizeAudit(db, workspaceId, auditId, async () => {}),
    },
    { owner: 'worker', taskScope: scope, send, ...(now ? { now } : {}) },
  );
}
async function ready(id: string) {
  await db
    .updateTable('audit_tasks')
    .set({ available_at: new Date(0) })
    .where('id', '=', id)
    .execute();
}
async function stored(id: string) {
  return db.selectFrom('audit_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}
describe('leased audit worker phases', () => {
  it.each([
    { elapsed: 60, liveLimit: 600, expired: true },
    { elapsed: 61, liveLimit: 600, expired: true },
    { elapsed: 59, liveLimit: 1, expired: false },
  ])(
    'uses the frozen run deadline at $elapsed seconds (live limit $liveLimit)',
    async ({ elapsed, liveLimit, expired }) => {
      const t = await seed(),
        at = new Date();
      const audit = await db
        .selectFrom('audits')
        .select('configuration')
        .where('id', '=', t.auditId)
        .executeTakeFirstOrThrow();
      await db
        .updateTable('audits')
        .set({
          status: 'running',
          started_at: new Date(at.getTime() - elapsed * 1000),
          configuration: JSON.stringify({ ...record(audit.configuration), max_run_seconds: 60 }),
        })
        .where('id', '=', t.auditId)
        .execute();
      let calls = 0;
      await worker(
        t,
        async () => {
          calls++;
          return Response.json({
            status: 'completed',
            output: [
              { type: 'message', content: [{ type: 'output_text', text: 'Acme Running.' }] },
            ],
          });
        },
        { ...runtime, audits: { ...runtime.audits, max_run_seconds: liveLimit } },
        () => at,
      ).runOnce();
      expect(calls).toBe(expired ? 0 : 1);
      expect(await stored(t.task.id)).toMatchObject(
        expired
          ? { status: 'failed', error_code: 'run_deadline_exceeded', attempt_count: 0 }
          : { status: 'succeeded', attempt_count: 1 },
      );
    },
  );
  it('makes one direct call per lease, persists a retry, and retains both actual attempts on success', async () => {
    const t = await seed();
    let calls = 0;
    const w = worker(t, async () => {
      calls++;
      if (calls === 1) throw new TypeError('transport failed');
      return Response.json({
        id: 'response-id',
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: 'Acme Running suits road use.', annotations: [] },
            ],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });
    });
    expect(await w.runOnce()).toBe(1);
    expect(await stored(t.task.id)).toMatchObject({
      status: 'retry_wait',
      attempt_count: 1,
      error_code: 'connection',
    });
    expect(calls).toBe(1);
    await ready(t.task.id);
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({ status: 'succeeded', attempt_count: 2 });
    const attempts = await db
      .selectFrom('provider_attempts')
      .select(['status', 'attempt_number'])
      .where('task_id', '=', t.task.id)
      .orderBy('attempt_number')
      .execute();
    expect(attempts).toEqual([
      { status: 'failed', attempt_number: 1 },
      { status: 'succeeded', attempt_number: 2 },
    ]);
    expect(calls).toBe(2);
  });
  it('recovers an uncertain paid submission by exact tag and then GET, never repeating task_post', async () => {
    const t = await seed(true),
      methods: string[] = [];
    let tick = Date.now();
    const w = worker(
      t,
      async (input, options) => {
        const url = String(input);
        methods.push(`${options?.method} ${url}`);
        if (url.endsWith('/task_post')) throw new TypeError('submission receipt lost');
        if (url.endsWith('/id_list')) {
          const current = await stored(t.task.id);
          return Response.json({
            status_code: 20000,
            tasks: [
              {
                status_code: 20000,
                result: [
                  {
                    id: 'provider-id',
                    cost: 0.0018,
                    metadata: {
                      tag: current.provider_submission_ref,
                      api: 'ai_optimization',
                      se: 'chat_gpt',
                      function: 'llm_scraper',
                    },
                  },
                ],
              },
            ],
          });
        }
        return Response.json({
          status_code: 20000,
          tasks: [
            {
              id: 'provider-id',
              status_code: 20000,
              result: [
                {
                  markdown: 'Acme Running shoes are available.',
                  fan_out_queries: ['  running shoes  ', 'running shoes'],
                  sources: [{ url: 'https://acme.example/shoes' }],
                },
              ],
            },
          ],
        });
      },
      runtime,
      () => new Date(tick),
    );
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({
      status: 'submission_uncertain',
      attempt_count: 1,
      provider_task_id: '',
    });
    await db
      .updateTable('audit_tasks')
      .set({ provider_task_submitted_at: new Date(Date.now() - 120000), available_at: new Date(0) })
      .where('id', '=', t.task.id)
      .execute();
    tick += 2000;
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({
      status: 'awaiting_provider_result',
      provider_task_id: 'provider-id',
      provider_poll_count: 0,
      attempt_count: 1,
    });
    tick += 2000;
    await ready(t.task.id);
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    expect(methods.map((value) => value.split('/').at(-1))).toEqual([
      'task_post',
      'id_list',
      'provider-id',
    ]);
    expect(methods.filter((value) => value.includes('/task_post'))).toHaveLength(1);
    const artifact = await db
      .selectFrom('raw_response_artifacts')
      .selectAll()
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(record(artifact.usage).provider_cost_microusd).toBe(1800);
    expect(record(artifact.provider_metadata)).toMatchObject({
      fanout_availability: 'queries_available',
      query_text_available: true,
    });
    const analysis = await db
      .selectFrom('response_analyses')
      .selectAll()
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(analysis).toMatchObject({
      artifact_id: artifact.id,
      audit_id: t.task.audit_id,
      workspace_id: t.task.workspace_id,
      fanout_state: 'queries_available',
      fanout_queries: ['running shoes', 'running shoes'],
      fanout_event_count: 2,
      fanout_event_source: 'raw_artifact',
      fanout_projection_version: 'fanout-1',
    });
    await w.runOnce();
    expect(
      await db
        .selectFrom('response_analyses')
        .select('id')
        .where('task_id', '=', t.task.id)
        .execute(),
    ).toEqual([{ id: analysis.id }]);
  });
  it('parks capacity without dispatch, attempt evidence or retry spending', async () => {
    const t = await seed();
    let calls = 0;
    const w = worker(
      t,
      async () => {
        calls++;
        throw new Error('Unexpected dispatch');
      },
      { ...runtime, audits: { ...runtime.audits, per_transport_concurrency: 0 } },
    );
    await w.runOnce();
    expect(calls).toBe(0);
    expect(await stored(t.task.id)).toMatchObject({
      status: 'capacity_wait',
      attempt_count: 0,
      lease_owner: null,
    });
    expect(
      await db
        .selectFrom('provider_attempts')
        .select('id')
        .where('task_id', '=', t.task.id)
        .execute(),
    ).toHaveLength(0);
  });
  it('does not write off a paid submission at the run cap; the poll ceiling and recovery deadline bound it', async () => {
    const t = await seed(true);
    await db
      .updateTable('audits')
      .set({ status: 'running', started_at: new Date(Date.now() - 7200000) })
      .where('id', '=', t.auditId)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({
        provider_submission_ref: 'paid-intent',
        provider_task_submitted_at: new Date(Date.now() - 60000),
        provider_connection_id: record(t.task.provider_route_snapshot).connection_id as string,
      })
      .where('id', '=', t.task.id)
      .execute();
    await worker(t, async () => Response.json({ status_code: 20000, tasks: [] })).runOnce();
    expect((await stored(t.task.id)).error_code).not.toBe('poll_ceiling_exceeded');
  });
  it('closes expired scraper recovery with retained charge and no provider or analysis call', async () => {
    const t = await seed(true);
    let calls = 0;
    await db
      .updateTable('audit_tasks')
      .set({
        provider_submission_ref: 'paid-intent',
        provider_task_submitted_at: new Date(Date.now() - 96 * 3600000),
        provider_connection_id: record(t.task.provider_route_snapshot).connection_id as string,
        provider_metadata: JSON.stringify({ provider_submission_cost_microusd: 1800 }),
      })
      .where('id', '=', t.task.id)
      .execute();
    const w = worker(t, async () => {
      calls++;
      throw new Error('Unexpected provider call');
    });
    await w.runOnce();
    expect(calls).toBe(0);
    expect(await stored(t.task.id)).toMatchObject({
      status: 'failed',
      error_code: 'submission_unreconciled',
    });
    const artifact = await db
      .selectFrom('raw_response_artifacts')
      .selectAll()
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(record(artifact.usage).provider_cost_microusd).toBe(1800);
    expect(
      await db
        .selectFrom('response_analyses')
        .select('id')
        .where('task_id', '=', t.task.id)
        .execute(),
    ).toHaveLength(0);
  });
});
