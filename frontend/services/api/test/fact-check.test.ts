/**
 * Fact-checking against real PostgreSQL: the pilot-gated brand facts API and
 * its revisions, the fact set an audit freezes, claim extraction riding the
 * perception call, the verification executor's persisted outcomes, the
 * accuracy and evidence reads, and workspace isolation. The model gateway is
 * a fake transport.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeExecution } from '../src/analysis/execution.ts';
import { createApp } from '../src/app.ts';
import { loadWorkerSettings, policy } from '../src/config.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { admittedFactCheck, admittedPerceptionVersions } from '../src/perception/admission.ts';
import { answerPerception } from '../src/perception/executor.ts';
import { factVerification } from '../src/perception/fact-verification.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new VisibilityFixtures(db);
const settings = loadWorkerSettings({});
const ANSWER = 'Acme Pro costs $49 per month. Acme integrates with Slack. Rival support is slow.';

let tenant: Tenant;

beforeEach(async () => {
  tenant = await fixtures.tenant();
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

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

/** A pilot audit's configuration, frozen the way admission freezes it. */
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
    language_code: 'en',
    perception: admittedPerceptionVersions('brand', factCheck),
    fact_check: factCheck,
  };
}

/** A succeeded execution analysed the way the result transaction analyses it. */
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
  await db.transaction().execute((trx) => analyzeExecution(trx, task, audit, artifactId));
  return taskId;
}

function fakeGateway(contents: string[]) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    Response.json({
      model: 'returned-model',
      choices: [{ message: { content: contents.shift() ?? 'not json' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  );
  const gateway = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model: 'test',
      baseUrl: 'https://model.test/v1',
    },
    { fetch, sleep: async () => {} },
  );
  return { fetch, factory: () => gateway };
}

const perceptionOutput = JSON.stringify({
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

describe('brand facts', () => {
  it('appends a revision on every change and refuses an edit of a stale revision', async () => {
    const created = await call(tenant, 'POST', '/brand-facts', {
      topic: 'pricing',
      statement: 'Pro costs $59 per month.',
    });
    expect(created.body).toMatchObject({ status: 'draft', revision: 1, source_url: null });
    const id = String(created.body.id);
    const confirmed = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 1,
      status: 'confirmed',
    });
    expect(confirmed.body).toMatchObject({ status: 'confirmed', revision: 2 });
    const stale = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 1,
      statement: 'Pro costs $69 per month.',
    });
    expect(stale.status).toBe(409);
    const retired = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 2,
      status: 'retired',
    });
    expect(retired.body).toMatchObject({ status: 'retired', revision: 3 });
    const revived = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 3,
      status: 'confirmed',
    });
    expect(revived.status).toBe(409);
    const revisions = await db
      .selectFrom('brand_fact_revisions')
      .select(['revision', 'status', 'statement', 'created_by_user_id'])
      .where('fact_id', '=', id)
      .orderBy('revision')
      .execute();
    expect(revisions).toEqual([
      {
        revision: 1,
        status: 'draft',
        statement: 'Pro costs $59 per month.',
        created_by_user_id: tenant.userId,
      },
      {
        revision: 2,
        status: 'confirmed',
        statement: 'Pro costs $59 per month.',
        created_by_user_id: tenant.userId,
      },
      {
        revision: 3,
        status: 'retired',
        statement: 'Pro costs $59 per month.',
        created_by_user_id: tenant.userId,
      },
    ]);
  });

  it("never reads or edits another workspace's facts", async () => {
    const id = await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const other = await fixtures.tenant();
    expect((await call(other, 'GET', '/brand-facts')).body).toEqual({ enabled: true, facts: [] });
    const forged = await call(other, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 2,
      status: 'retired',
    });
    expect(forged.status).toBe(404);
  });

  it('freezes only the newest confirmed revisions, and nothing outside the pilot', async () => {
    expect(
      await admittedFactCheck(db, {
        workspaceId: tenant.workspaceId,
        projectId: tenant.projectId,
        auditScope: 'brand',
      }),
    ).toBeNull();
    const confirmed = await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    await call(tenant, 'PATCH', `/brand-facts/${confirmed}`, {
      expected_revision: 2,
      statement: 'Pro costs $69 per month.',
    });
    await call(tenant, 'POST', '/brand-facts', { topic: 'company', statement: 'Draft only.' });
    const retired = await confirmedFact(tenant, 'markets', 'Sold in the US.');
    await call(tenant, 'PATCH', `/brand-facts/${retired}`, {
      expected_revision: 2,
      status: 'retired',
    });
    const frozen = await admittedFactCheck(db, {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      auditScope: 'brand',
    });
    const newest = await db
      .selectFrom('brand_fact_revisions')
      .select('id')
      .where('fact_id', '=', confirmed)
      .where('revision', '=', 3)
      .executeTakeFirstOrThrow();
    expect(frozen?.facts).toEqual([{ revision_id: newest.id, topic: 'pricing' }]);
    expect(
      await admittedFactCheck(db, {
        workspaceId: tenant.workspaceId,
        projectId: tenant.projectId,
        auditScope: 'commerce',
      }),
    ).toBeNull();
  });
});

describe('claim extraction and verification', () => {
  it('extracts brand claims in the perception call, verifies them against the frozen facts and reads the accuracy', async () => {
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    const taskId = await analysed(tenant, auditId);
    const perception = fakeGateway([perceptionOutput]);
    await drain(tenant, 'answer_perception', answerPerception(perception.factory));
    const sent = JSON.parse(String(perception.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(
      sent.messages[0]?.content.endsWith(policy.perception.fact_check.claims_system_addendum),
    ).toBe(true);
    const claims = await db
      .selectFrom('answer_claims')
      .select(['topic', 'quote', 'quote_start', 'quote_end'])
      .where('workspace_id', '=', tenant.workspaceId)
      .orderBy('ordinal')
      .execute();
    expect(claims).toEqual([
      { topic: 'pricing', quote: 'Acme Pro costs $49 per month', quote_start: 0, quote_end: 28 },
      {
        topic: 'integrations',
        quote: 'Acme integrates with Slack',
        quote_start: 30,
        quote_end: 56,
      },
    ]);
    expect((await queued(tenant, 'fact_verification')).map((row) => row.status)).toEqual([
      'queued',
    ]);

    const verify = fakeGateway([
      JSON.stringify({
        verdicts: [{ claim_id: 'c1', verdict: 'contradicted', fact_ids: ['f1'], confidence: 0.9 }],
      }),
    ]);
    await drain(tenant, 'fact_verification', factVerification(verify.factory));
    const verifyRequest = JSON.parse(String(verify.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    // Only the pricing claim has a fact on its topic; the integration claim is never sent.
    expect(verifyRequest.messages[1]?.content).toContain('Pro costs $59 per month.');
    expect(verifyRequest.messages[1]?.content).not.toContain('Slack');

    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      state: 'value',
      score: {
        accuracy: 0,
        coverage: { claims: 2, contradicted: 1, not_covered: 1, supported: 0, pending: 0 },
      },
      contradicted: [
        {
          quote: 'Acme Pro costs $49 per month',
          topic: 'pricing',
          verdict: 'contradicted',
          facts: [{ topic: 'pricing', statement: 'Pro costs $59 per month.', source_url: null }],
          run_id: auditId,
          execution_id: taskId,
        },
      ],
    });

    // Editing the fact afterwards never rewrites this audit's verdict.
    const [fact] = (await call(tenant, 'GET', '/brand-facts')).body.facts as { id: string }[];
    await call(tenant, 'PATCH', `/brand-facts/${fact!.id}`, {
      expected_revision: 2,
      statement: 'Pro costs $49 per month.',
    });
    const token = await sessionToken({ sub: tenant.userId, ver: 0 });
    const execution = (await (
      await app.request(`/api/v1/executions/${taskId}`, {
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'x-workspace-id': tenant.workspaceId,
        },
      })
    ).json()) as { claims: { verdict: string | null; facts: { statement: string }[] }[] };
    expect(execution.claims.map((row) => [row.verdict, row.facts.map((f) => f.statement)])).toEqual(
      [
        ['contradicted', ['Pro costs $59 per month.']],
        ['not_covered', []],
      ],
    );
  });

  it('verifies a claim the extractor filed under a neighbouring topic instead of calling it not covered', async () => {
    await confirmedFact(tenant, 'specs', 'The Pro plan includes 50 projects.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    await analysed(tenant, auditId, 'Acme Pro includes unlimited projects. Rival support is slow.');
    const extraction = JSON.stringify({
      entities: [{ entity_id: 'brand:acme', label: 'neutral', confidence: 0.9, aspects: [] }],
      claims: [
        {
          topic: 'plans',
          claim: 'Acme Pro includes unlimited projects.',
          quote: 'Acme Pro includes unlimited projects',
          confidence: 0.9,
        },
      ],
    });
    await drain(tenant, 'answer_perception', answerPerception(fakeGateway([extraction]).factory));
    const verify = fakeGateway([
      JSON.stringify({
        verdicts: [{ claim_id: 'c1', verdict: 'contradicted', fact_ids: ['f1'], confidence: 0.9 }],
      }),
    ]);
    await drain(tenant, 'fact_verification', factVerification(verify.factory));
    const request = JSON.parse(String(verify.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(request.messages[1]?.content).toContain('The Pro plan includes 50 projects.');
    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      score: { coverage: { claims: 1, contradicted: 1, not_covered: 0 } },
      contradicted: [
        { topic: 'plans', facts: [{ statement: 'The Pro plan includes 50 projects.' }] },
      ],
    });
  });

  it('extracts no claims for an audit admitted without confirmed facts', async () => {
    const configuration = await pilotConfiguration(tenant);
    expect(configuration.fact_check).toBeNull();
    const auditId = await fixtures.audit(tenant, { configuration });
    await analysed(tenant, auditId);
    const perception = fakeGateway([perceptionOutput]);
    await drain(tenant, 'answer_perception', answerPerception(perception.factory));
    const sent = JSON.parse(String(perception.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(sent.messages[0]?.content).toBe(policy.perception.system_template);
    const claims = await db
      .selectFrom('answer_claims')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect([claims.length, (await queued(tenant, 'fact_verification')).length]).toEqual([0, 0]);
    const accuracy = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(accuracy.body.state).toBe('no_facts');
  });

  it('ends over the cap or without a gateway as an explained unavailable outcome', async () => {
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    await analysed(tenant, auditId);
    await analysed(tenant, auditId, `${ANSWER} Again.`);
    await drain(
      tenant,
      'answer_perception',
      answerPerception(fakeGateway([perceptionOutput, perceptionOutput]).factory),
    );
    const verify = fakeGateway([
      JSON.stringify({
        verdicts: [{ claim_id: 'c1', verdict: 'supported', fact_ids: ['f1'], confidence: 0.9 }],
      }),
    ]);
    await drain(
      tenant,
      'fact_verification',
      factVerification(verify.factory, {
        ...policy.perception.fact_check,
        max_verifications_per_audit: 1,
      }),
    );
    const outcomes = await db
      .selectFrom('fact_verifications')
      .select(['outcome', 'outcome_reason'])
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(outcomes.map((row) => row.outcome_reason ?? row.outcome).toSorted()).toEqual([
      'platform_cap',
      'verified',
    ]);
    expect(verify.fetch).toHaveBeenCalledTimes(1);
    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      state: 'value',
      score: { coverage: { supported: 1, unavailable: [{ reason: 'platform_cap', count: 1 }] } },
    });

    const second = await fixtures.tenant();
    await confirmedFact(second, 'pricing', 'Pro costs $59 per month.');
    const secondAudit = await fixtures.audit(second, {
      configuration: await pilotConfiguration(second),
    });
    await analysed(second, secondAudit);
    await drain(
      second,
      'answer_perception',
      answerPerception(fakeGateway([perceptionOutput]).factory),
    );
    await drain(
      second,
      'fact_verification',
      factVerification(() => null),
    );
    const unconfigured = await call(second, 'GET', `/visibility/accuracy?audit_id=${secondAudit}`);
    // The integration claim has no fact on its topic, so it is not covered without a call.
    expect(unconfigured.body).toMatchObject({
      state: 'value',
      score: {
        accuracy: null,
        coverage: { not_covered: 1, unavailable: [{ reason: 'model_not_configured', count: 1 }] },
      },
    });
  });

  it('never reads or writes another workspace through a forged payload', async () => {
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    await analysed(tenant, auditId);
    await drain(
      tenant,
      'answer_perception',
      answerPerception(fakeGateway([perceptionOutput]).factory),
    );
    const [victim] = await queued(tenant, 'fact_verification');
    const attacker = await fixtures.tenant();
    await db
      .insertInto('analytics_tasks')
      .values({
        id: randomUUID(),
        workspace_id: attacker.workspaceId,
        project_id: attacker.projectId,
        task_kind: 'fact_verification',
        payload: JSON.stringify(victim!.payload),
        idempotency_key: `forged:${randomUUID()}`,
        status: 'queued',
        priority: 0,
        randomized_position: 0,
        available_at: new Date(),
        attempt_count: 0,
        max_attempts: 1,
        error_code: '',
        error_detail: '',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    const gateway = fakeGateway([]);
    await drain(attacker, 'fact_verification', factVerification(gateway.factory));
    expect(gateway.fetch).not.toHaveBeenCalled();
    expect((await queued(attacker, 'fact_verification')).map((row) => row.status)).toEqual([
      'failed',
    ]);
    const written = await db
      .selectFrom('fact_verifications')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(written).toEqual([]);
  });
});
