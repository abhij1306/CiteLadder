import { randomUUID } from 'node:crypto';
import { afterAll, afterEach } from 'vitest';
import { asOwner, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';
import { prompt } from './prompt-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { AuditWorker } from '../src/audits/worker.ts';
import { deriveExecution } from '../src/audits/derivation.ts';
import { finalizeAudit } from '../src/audits/finalization.ts';
import { createConnection } from '../src/providers/connections.ts';
import { createConnectionInput } from '../src/providers/inputs.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { dataforseoSecretIdentity } from '../src/providers/dataforseo-identity.ts';
import { record } from '../src/db/json.ts';

export function auditWorkerHarness() {
  const db = testDatabase(),
    fixtures = new VisibilityFixtures(db),
    base = auditRuntime({});
  const runtime = { ...base, audits: { ...base.audits, worker_concurrency: 1 } };
  const workspaces: string[] = [],
    tasks: string[] = [],
    accountPools: string[] = [];
  afterEach(async () => {
    if (tasks.length) {
      await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
      await asOwner((owner) =>
        owner.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute(),
      );
    }
    if (workspaces.length)
      await db
        .deleteFrom('provider_capacity_buckets')
        .where(
          'connection_id',
          'in',
          db
            .selectFrom('provider_connections')
            .select('id')
            .where('workspace_id', 'in', workspaces),
        )
        .execute();
    if (accountPools.length)
      await db
        .deleteFrom('provider_capacity_buckets')
        .where('account_pool_identity', 'in', accountPools)
        .execute();
    await fixtures.cleanup();
    tasks.length = 0;
    workspaces.length = 0;
    accountPools.length = 0;
  });
  afterAll(async () => {
    await db.destroy();
  });
  async function seed(
    surface = false,
    extraPrompts: string[] = [],
    observed: 'chatgpt_search' | 'google_ai_overview' | 'google_ai_mode' = 'chatgpt_search',
  ) {
    const t = await auditTenant(db, fixtures);
    workspaces.push(t.workspaceId);
    for (const text of extraPrompts) await prompt(db, t.setId, text);
    if (surface) {
      const login = `worker-${randomUUID()}@example.com`;
      accountPools.push(
        dataforseoSecretIdentity(JSON.stringify({ login, password: 'x' }), auditTestKey),
      );
      const c = await createConnection(
        db,
        t.workspaceId,
        t.userId,
        createConnectionInput.parse({
          transport_provider: 'dataforseo',
          api_login: login,
          api_password: 'test',
          routes: [{ logical_engine: observed }],
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
        engines: [surface ? observed : 'chatgpt'],
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
        execution: deriveExecution,
        finalize: (workspaceId, auditId) => finalizeAudit(db, workspaceId, auditId, async () => {}),
      },
      { owner: 'worker', taskScope: scope, send, ...(now ? { now } : {}) },
    );
  }
  async function submittedOverview(
    pollCount: number,
    engine: 'google_ai_overview' | 'google_ai_mode' = 'google_ai_overview',
  ) {
    const t = await seed(true, [], engine);
    const connectionId = record(t.task.provider_route_snapshot).connection_id as string;
    const { credential_revision } = await db
      .selectFrom('provider_connections')
      .select('credential_revision')
      .where('id', '=', connectionId)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('audit_tasks')
      .set({
        provider_submission_ref: 'paid-intent',
        provider_task_submitted_at: new Date(Date.now() - 60000),
        provider_task_id: 'aio-task',
        provider_poll_count: pollCount,
        attempt_count: 1,
        provider_connection_id: connectionId,
        provider_credential_revision: credential_revision,
      })
      .where('id', '=', t.task.id)
      .execute();
    return t;
  }
  async function ready(id: string) {
    await db
      .updateTable('audit_tasks')
      .set({ available_at: new Date(0) })
      .where('id', '=', id)
      .execute();
  }
  function stored(id: string) {
    return db.selectFrom('audit_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }
  return {
    db,
    fixtures,
    runtime,
    workspaces,
    tasks,
    seed,
    worker,
    submittedOverview,
    ready,
    stored,
  };
}
