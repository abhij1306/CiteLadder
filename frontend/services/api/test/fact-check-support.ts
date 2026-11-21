import { randomUUID } from 'node:crypto';

import { vi } from 'vitest';

import { deriveExecution } from '../src/audits/derivation.ts';
import { createApp } from '../src/app.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { admittedFactCheck, admittedPerceptionVersions } from '../src/perception/admission.ts';
import type { answerPerception } from '../src/perception/executor.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

export const ANSWER =
  'Acme Pro costs $49 per month. Acme integrates with Slack. Rival support is slow.';

export function fakeGateway(contents: string[], model = 'test') {
  const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      Response.json({
        model: 'returned-model',
        choices: [{ message: { content: contents.shift() ?? 'not json' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    ),
  );
  const gateway = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model,
      baseUrl: 'https://model.test/v1',
    },
    { fetch, sleep: async () => {} },
  );
  return { fetch, factory: () => gateway };
}

export const perceptionOutput = JSON.stringify({
  entities: [
    { entity_id: 'brand:acme', label: 'neutral', confidence: 0.9, aspects: [] },
    { entity_id: 'competitor:rival', label: 'negative', confidence: 0.8, aspects: [] },
  ],
  claims: [
    {
      topic: 'pricing',
      claim: 'Acme Pro costs $49 a month.',
      quote: 'Acme Pro costs $49 per month',
      confidence: 0.9,
    },
    {
      topic: 'integrations',
      claim: 'Acme integrates with Slack.',
      quote: 'Acme integrates with Slack',
      confidence: 0.9,
    },
    { topic: 'pricing', claim: 'Rival is cheaper.', quote: 'Rival is cheaper', confidence: 0.9 },
  ],
});

export function factCheckHarness() {
  const config = testConfig();
  const db = testDatabase(config);
  const app = createApp(config, db);
  const fixtures = new VisibilityFixtures(db);
  const settings = loadWorkerSettings({});

  async function call(owner: Tenant, method: string, path: string, body?: unknown) {
    const token = await sessionToken({ sub: owner.userId, ver: 0 });
    const response = await app.request(`/api/v1/projects/${owner.projectId}${path}`, {
      method,
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${token}`,
        'x-workspace-id': owner.workspaceId,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function confirmedFact(owner: Tenant, topic: string, statement: string) {
    const created = await call(owner, 'POST', '/brand-facts', { topic, statement });
    const id = String(created.body.id);
    await call(owner, 'PATCH', `/brand-facts/${id}`, { expected_revision: 1, status: 'confirmed' });
    return id;
  }

  async function pilotConfiguration(owner: Tenant) {
    const factCheck = await admittedFactCheck(db, {
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      auditScope: 'brand',
    });
    return {
      brand_name: 'Acme',
      brand_aliases: [],
      competitors: [{ name: 'Rival', domains: [], aliases: [] }],
      country_code: 'US',
      language_code: 'en',
      perception: admittedPerceptionVersions({ auditScope: 'brand', factCheck, model: 'test' }),
      fact_check: factCheck,
    };
  }

  async function analysed(owner: Tenant, auditId: string, answerText = ANSWER) {
    const { taskId } = await fixtures.execution(owner, {
      auditId,
      answerText,
      promptText: 'best tools?',
      analysis: null,
    });
    const artifactId = randomUUID();
    await db
      .insertInto('raw_response_artifacts')
      .values({
        id: artifactId,
        workspace_id: owner.workspaceId,
        audit_id: auditId,
        task_id: taskId,
        logical_engine: 'chatgpt',
        transport_provider: 'test',
        transport_model: 'test-model',
        answer_text: answerText,
        search_used: false,
        finish_reason: 'stop',
        created_at: new Date(),
      })
      .execute();
    const audit = await db
      .selectFrom('audits')
      .selectAll()
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow();
    const task = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    await db.transaction().execute((trx) => deriveExecution(trx, task, audit, artifactId));
    return taskId;
  }

  async function drain(owner: Tenant, kind: string, executor: ReturnType<typeof answerPerception>) {
    const ids = (
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('workspace_id', '=', owner.workspaceId)
        .where('task_kind', '=', kind)
        .execute()
    ).map((row) => row.id);
    const worker = new AnalyticsWorker(db, settings, {
      executors: { [kind]: executor },
      taskScope: { workspaceId: owner.workspaceId, taskIds: ids },
    });
    await worker.runUntilIdle();
    return ids;
  }

  const queued = (owner: Tenant, kind: string) =>
    db
      .selectFrom('analytics_tasks')
      .select(['status', 'payload'])
      .where('workspace_id', '=', owner.workspaceId)
      .where('task_kind', '=', kind)
      .execute();

  return {
    config,
    db,
    app,
    fixtures,
    call,
    confirmedFact,
    pilotConfiguration,
    analysed,
    drain,
    queued,
  };
}
