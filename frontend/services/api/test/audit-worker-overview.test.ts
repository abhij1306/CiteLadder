import { describe, expect, it } from 'vitest';
import { auditTestKey } from './audit-fixtures.ts';
import { auditWorkerHarness } from './audit-worker-fixtures.ts';
import { AuditWorker } from '../src/audits/worker.ts';
import { AuditMaintenance } from '../src/audits/maintenance.ts';
import { deriveExecution } from '../src/audits/derivation.ts';
import { finalizeAudit } from '../src/audits/finalization.ts';
import { record } from '../src/db/json.ts';

const { db, runtime, seed, worker, submittedOverview, ready, stored } = auditWorkerHarness();

describe('leased Google AI Overview phases', () => {
  it('keeps a paid submission whose receipt failed to save for lease-expiry reconciliation', async () => {
    const t = await seed(true, [], 'google_ai_overview');
    let failNextTransaction = false;
    const flaky = new Proxy(db, {
      get(target, property) {
        if (property === 'transaction' && failNextTransaction) {
          failNextTransaction = false;
          return () => ({
            execute: async () => {
              throw new Error('Connection terminated unexpectedly');
            },
          });
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await new AuditWorker(
      flaky,
      runtime,
      auditTestKey,
      {
        execution: deriveExecution,
        finalize: (workspaceId, auditId) => finalizeAudit(db, workspaceId, auditId, async () => {}),
      },
      {
        owner: 'worker',
        taskScope: t,
        env: {},
        send: async () => {
          failNextTransaction = true;
          return Response.json({
            status_code: 20000,
            tasks: [{ id: 'aio-task', status_code: 20100, cost: 0.0012 }],
          });
        },
      },
    ).runOnce();
    const leased = await stored(t.task.id);
    expect([leased.status, leased.provider_task_id]).toEqual(['running', '']);
    await db
      .updateTable('audit_tasks')
      .set({ lease_expires_at: new Date(0) })
      .where('id', '=', t.task.id)
      .execute();
    await new AuditMaintenance(db, async () => {}).recoverLeases();
    expect(await stored(t.task.id)).toMatchObject({
      status: 'submission_uncertain',
      provider_submission_ref: leased.provider_submission_ref,
      attempt_count: 0,
    });
    expect(leased.provider_submission_ref).not.toBe('');
  });
  it('sends a rate-limited submission again without spending an attempt', async () => {
    const t = await seed(true, [], 'google_ai_overview'),
      posts: string[] = [];
    let tick = Date.now();
    const w = worker(
      t,
      async (input, options) => {
        posts.push(JSON.parse(String(options?.body))[0].tag);
        return Response.json(
          posts.length === 1
            ? { status_code: 40202, status_message: 'Rate limit per minute exceeded', tasks: null }
            : { status_code: 20000, tasks: [{ id: 'aio-task', status_code: 20100, cost: 0.0012 }] },
        );
      },
      runtime,
      () => new Date(tick),
    );
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({
      status: 'retry_wait',
      error_code: '',
      provider_submission_ref: '',
      provider_task_submitted_at: null,
      attempt_count: 0,
    });
    tick += 61000;
    await ready(t.task.id);
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({
      status: 'awaiting_provider_result',
      provider_task_id: 'aio-task',
      attempt_count: 1,
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]).toBe(posts[0]);
  });
  it('observes a Google AI Overview with one paid submission and a free retrieval', async () => {
    const t = await seed(true, [], 'google_ai_overview'),
      paths: string[] = [];
    let tick = Date.now();
    const clock = () => new Date(tick);
    const w = worker(
      t,
      async (input) => {
        const url = String(input);
        paths.push(url.split('/').slice(-2).join('/'));
        if (url.endsWith('/task_post'))
          return Response.json({
            status_code: 20000,
            tasks: [{ id: 'aio-task', status_code: 20100, cost: 0.002 }],
          });
        return Response.json({
          status_code: 20000,
          tasks: [
            {
              id: 'aio-task',
              status_code: 20000,
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
        });
      },
      runtime,
      clock,
    );
    await w.runOnce();
    expect(await stored(t.task.id)).toMatchObject({
      status: 'awaiting_provider_result',
      provider_task_id: 'aio-task',
      attempt_count: 1,
    });
    tick += 2000;
    await ready(t.task.id);
    await w.runOnce();
    expect(paths).toEqual(['organic/task_post', 'advanced/aio-task']);
    expect(await stored(t.task.id)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    const observation = await db
      .selectFrom('aio_observations')
      .select(['outcome', 'provider_task_id', 'reference_count'])
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(observation).toEqual({
      outcome: 'ai_overview_present',
      provider_task_id: 'aio-task',
      reference_count: 1,
    });
    const artifact = await db
      .selectFrom('raw_response_artifacts')
      .select('usage')
      .where('task_id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(record(artifact.usage).provider_cost_microusd).toBe(2000);
  });
  it('stops a Google AI Overview at the poll ceiling without another provider call', async () => {
    const t = await submittedOverview(1000);
    let calls = 0;
    await worker(t, async () => {
      calls++;
      throw new Error('Unexpected provider call');
    }).runOnce();
    expect(calls).toBe(0);
    expect(await stored(t.task.id)).toMatchObject({
      status: 'failed',
      error_code: 'poll_ceiling_exceeded',
      attempt_count: 1,
    });
    expect(
      await db
        .selectFrom('aio_observations')
        .select(['outcome', 'error_code'])
        .where('task_id', '=', t.task.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ outcome: 'execution_failure', error_code: 'poll_ceiling_exceeded' });
  });
  it('polls a paid Google AI Overview again when saving its answer fails, never writing it off', async () => {
    const t = await submittedOverview(0);
    const paths: string[] = [];
    let tick = Date.now();
    let saves = 0;
    const w = new AuditWorker(
      db,
      runtime,
      auditTestKey,
      {
        execution: async (...args) => {
          if (++saves === 1) throw new Error('Connection terminated unexpectedly');
          return deriveExecution(...args);
        },
        finalize: (workspaceId, auditId) => finalizeAudit(db, workspaceId, auditId, async () => {}),
      },
      {
        owner: 'worker',
        taskScope: t,
        env: {},
        now: () => new Date(tick),
        send: async (input) => {
          paths.push(String(input).split('/').slice(-2).join('/'));
          return Response.json({
            status_code: 20000,
            tasks: [
              {
                id: 'aio-task',
                status_code: 20000,
                result: [{ items: [{ type: 'organic', title: 'No overview here' }] }],
              },
            ],
          });
        },
      },
    );
    await w.runOnce();
    const parked = await stored(t.task.id);
    expect([parked.status, parked.attempt_count, parked.provider_poll_count]).toEqual([
      'awaiting_provider_result',
      1,
      1,
    ]);
    tick += 2000;
    await ready(t.task.id);
    await w.runOnce();
    expect(paths).toEqual(['advanced/aio-task', 'advanced/aio-task']);
    expect(await stored(t.task.id)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    expect(
      await db
        .selectFrom('provider_attempts')
        .select(['status', 'error_code'])
        .where('task_id', '=', t.task.id)
        .orderBy('attempt_number')
        .execute(),
    ).toEqual([
      { status: 'failed', error_code: 'result_unsaved' },
      { status: 'succeeded', error_code: '' },
    ]);
  });
  it('records a retrieval whose credential is gone with its full failure code', async () => {
    const t = await seed(true, [], 'google_ai_overview');
    const connectionId = record(t.task.provider_route_snapshot).connection_id as string;
    await db
      .updateTable('audit_tasks')
      .set({
        provider_submission_ref: 'paid-intent',
        provider_task_submitted_at: new Date(Date.now() - 60000),
        provider_task_id: 'aio-task',
        attempt_count: 1,
        provider_connection_id: connectionId,
      })
      .where('id', '=', t.task.id)
      .execute();
    await db
      .updateTable('provider_connections')
      .set({ active: false })
      .where('id', '=', connectionId)
      .execute();
    let calls = 0;
    await worker(t, async () => {
      calls++;
      throw new Error('Unexpected provider call');
    }).runOnce();
    expect(calls).toBe(0);
    expect(await stored(t.task.id)).toMatchObject({
      status: 'failed',
      error_code: 'credential_unavailable_for_retrieval',
    });
    expect(
      await db
        .selectFrom('aio_observations')
        .select(['outcome', 'error_code'])
        .where('task_id', '=', t.task.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ outcome: 'execution_failure', error_code: 'credential_unavailable_for_retrieval' });
  });
});
