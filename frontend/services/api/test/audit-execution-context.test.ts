import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createAudits } from '../src/audits/creation.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import {
  directRequest,
  frozenSurfaceRequest,
  loadExecutionContext,
} from '../src/audits/execution-context.ts';
import { commitSubmissionIntent } from '../src/audits/submission-intent.ts';
import { AuditQueue } from '../src/queue/audit-queue.ts';
import { createConnection, updateConnection } from '../src/providers/connections.ts';
import { createConnectionInput, updateConnectionInput } from '../src/providers/inputs.ts';
import { probeConnection } from '../src/providers/probes.ts';
import { record } from '../src/db/json.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({});
const queue = new AuditQueue(db, 120);
afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});
async function seed(surface = false) {
  const t = await auditTenant(db, fixtures);
  let connectionId = t.connectionId;
  if (surface) {
    const connection = await createConnection(
      db,
      t.workspaceId,
      t.userId,
      createConnectionInput.parse({
        transport_provider: 'dataforseo',
        api_login: 'test@example.com',
        api_password: 'test-password',
        routes: [{ logical_engine: 'chatgpt_search' }],
      }),
      auditTestKey,
      runtime.providers,
    );
    connectionId = connection.id;
    await probeConnection(
      db,
      t.workspaceId,
      connectionId,
      auditTestKey,
      runtime.providers,
      async () => ({ status: 200, body: { status_code: 20000, tasks: [] } }),
    );
  }
  const [id] = await createAudits(
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
  const [task] = await queue.claim('worker', 1, { workspaceId: t.workspaceId, auditId: id });
  expect(task?.audit_id).toBe(id);
  return { ...t, connectionId, task: task! };
}
describe('frozen audit execution identity', () => {
  it('builds the detached request from the stored plan despite mutable project and runtime edits', async () => {
    const t = await seed();
    await db
      .updateTable('projects')
      .set({ country_code: 'IN' })
      .where('id', '=', t.projectId)
      .execute();
    await db
      .updateTable('prompts')
      .set({ text: 'Changed later' })
      .where('id', '=', t.promptId)
      .execute();
    const context = await loadExecutionContext(
      db,
      t.task,
      'worker',
      {
        ...runtime,
        audits: { ...runtime.audits, audit_timeout_seconds: 1, audit_max_output_tokens: 5 },
      },
      auditTestKey,
      new Date(),
    );
    const request = directRequest(context!);
    expect(request).toMatchObject({
      prompt: 'Which running shoes suit road use?',
      country_code: 'US',
      timeout_seconds: runtime.audits.audit_timeout_seconds,
      max_output_tokens: runtime.audits.audit_max_output_tokens,
      retrieval_enabled: true,
      reasoning_effort: 'low',
    });
    const stored = await db
      .selectFrom('audit_tasks')
      .select('provider_route_snapshot')
      .where('id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(stored)).not.toContain('test-key');
  });
  it('carries the Claude thinking mode from the frozen task route into the request', async () => {
    const t = await auditTenant(db, fixtures);
    const connection = await createConnection(
      db,
      t.workspaceId,
      t.userId,
      createConnectionInput.parse({
        transport_provider: 'anthropic',
        api_key: 'test-key',
        routes: [{ logical_engine: 'claude' }],
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
      async () => ({ status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }),
    );
    const [id] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['claude'] }),
      {},
      runtime,
    );
    const [task] = await queue.claim('worker', 1, { workspaceId: t.workspaceId, auditId: id });
    const context = await loadExecutionContext(
      db,
      task!,
      'worker',
      runtime,
      auditTestKey,
      new Date(),
    );
    expect(directRequest(context!)).toMatchObject({
      logical_engine: 'claude',
      reasoning_effort: 'low',
      anthropic_thinking: 'between_tools',
    });
  });
  it('rejects a frozen connection from another workspace and never reselects a replacement', async () => {
    const t = await seed(),
      other = await auditTenant(db, fixtures);
    await db
      .updateTable('audit_tasks')
      .set({
        provider_route_snapshot: JSON.stringify({
          ...record(t.task.provider_route_snapshot),
          connection_id: other.connectionId,
        }),
      })
      .where('id', '=', t.task.id)
      .execute();
    await expect(
      loadExecutionContext(db, t.task, 'worker', runtime, auditTestKey, new Date()),
    ).rejects.toMatchObject({ code: 'provider_connection_missing' });
  });
  it('commits exactly one submission intent and binds polling to that credential revision', async () => {
    const t = await seed(true);
    const context = (await loadExecutionContext(
      db,
      t.task,
      'worker',
      runtime,
      auditTestKey,
      new Date(),
    ))!;
    const intents = await Promise.all(
      [1, 2].map(() => commitSubmissionIntent(db, context, 'worker')),
    );
    expect(intents.map((intent) => intent?.fresh).sort()).toEqual([false, true]);
    const persisted = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(persisted).toMatchObject({
      provider_submission_ref: t.task.idempotency_key,
      provider_connection_id: t.connectionId,
      provider_credential_revision: context.revision,
      attempt_count: 0,
      provider_task_id: '',
    });
    const request = frozenSurfaceRequest(context, persisted.provider_submission_ref, runtime);
    expect(request).toMatchObject({
      location_code: 2840,
      request_settings: { priority: 1, force_web_search: true },
    });
    await updateConnection(
      db,
      t.workspaceId,
      t.userId,
      t.connectionId,
      updateConnectionInput.parse({ api_login: 'test@example.com', api_password: 'rotated' }),
      auditTestKey,
      runtime.providers,
    );
    await probeConnection(
      db,
      t.workspaceId,
      t.connectionId,
      auditTestKey,
      runtime.providers,
      async () => ({ status: 200, body: { status_code: 20000, tasks: [] } }),
    );
    await expect(
      loadExecutionContext(db, t.task, 'worker', runtime, auditTestKey, new Date()),
    ).rejects.toMatchObject({ code: 'connection_changed' });
  });
  it('refuses to commit a stale credential snapshot after a concurrent rotation', async () => {
    const t = await seed(true);
    const context = (await loadExecutionContext(
      db,
      t.task,
      'worker',
      runtime,
      auditTestKey,
      new Date(),
    ))!;
    await updateConnection(
      db,
      t.workspaceId,
      t.userId,
      t.connectionId,
      updateConnectionInput.parse({ api_login: 'test@example.com', api_password: 'rotated' }),
      auditTestKey,
      runtime.providers,
    );
    await expect(commitSubmissionIntent(db, context, 'worker')).rejects.toMatchObject({
      code: 'connection_changed',
    });
    const task = await db
      .selectFrom('audit_tasks')
      .select('provider_submission_ref')
      .where('id', '=', t.task.id)
      .executeTakeFirstOrThrow();
    expect(task.provider_submission_ref).toBe('');
  });
});
