import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveExecution } from '../src/audits/derivation.ts';
import { policy } from '../src/config.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { answerPerception } from '../src/perception/executor.ts';
import { rejectSuggestion } from '../src/projects/competitor-suggestions.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const settings = loadWorkerSettings({});
const configuration = {
  brand_name: 'Acme',
  brand_aliases: [],
  competitors: [{ name: 'Rival', domains: [], aliases: [] }],
  language_code: 'en',
  perception: {
    extractor_version: 'perception-extract-test',
    template_version: 'perception-template-test',
    metrics_version: 'perception-metrics-test',
    model: 'test',
  },
};
const ANSWER = '😀 Acme is the best value pick. Rival support is slow.';

let tenant: Tenant;

beforeEach(async () => {
  tenant = await fixtures.tenant();
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function analysed(
  owner: Tenant,
  auditId: string,
  answerText: string,
  at: { engine?: string; promptIndex?: number } = {},
) {
  const engine = at.engine ?? 'chatgpt';
  const { taskId } = await fixtures.execution(owner, {
    auditId,
    answerText,
    promptText: 'best tools?',
    analysis: null,
    engine,
    ...(at.promptIndex === undefined ? {} : { promptIndex: at.promptIndex }),
  });
  const artifactId = randomUUID();
  await db
    .insertInto('raw_response_artifacts')
    .values({
      id: artifactId,
      workspace_id: owner.workspaceId,
      audit_id: auditId,
      task_id: taskId,
      logical_engine: engine,
      transport_provider: 'test',
      transport_model: 'test-model',
      answer_text: answerText,
      search_used: false,
      finish_reason: 'stop',
      created_at: new Date(),
    })
    .execute();
  const derive = async () => {
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
  };
  await derive();
  const analysis = await db
    .selectFrom('response_analyses')
    .select('id')
    .where('task_id', '=', taskId)
    .executeTakeFirstOrThrow();
  return { taskId, analysisId: analysis.id, derive };
}

const queued = (workspaceId: string) =>
  db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('task_kind', '=', 'answer_perception')
    .execute();

function fakeGateway(contents: string[]) {
  const fetch = vi.fn(async () =>
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

const goodOutput = JSON.stringify({
  entities: [
    {
      entity_id: 'brand:acme',
      label: 'positive',
      confidence: 0.92,
      aspects: [
        { theme: 'value', polarity: 'positive', quote: 'the best value pick' },
        { theme: 'pricing', polarity: 'negative', quote: 'Acme costs too much' },
      ],
    },
    {
      entity_id: 'competitor:rival',
      label: 'negative',
      confidence: 0.8,
      aspects: [{ theme: 'support', polarity: 'negative', quote: 'Rival support is slow' }],
    },
  ],
  untracked_businesses: [],
});

async function drain(
  owner: Tenant,
  factory: Parameters<typeof answerPerception>[0],
  perception = policy.perception,
) {
  const ids = (await queued(owner.workspaceId)).map((row) => row.id);
  const worker = new AnalyticsWorker(db, settings, {
    executors: { answer_perception: answerPerception(factory, perception) },
    taskScope: { workspaceId: owner.workspaceId, taskIds: ids },
  });
  await worker.runUntilIdle();
  return ids;
}

const perceptions = (workspaceId: string) =>
  db
    .selectFrom('answer_perceptions')
    .select([
      'analysis_id',
      'outcome',
      'outcome_reason',
      'extractor_version',
      'drop_counts',
      'usage',
      'model',
    ])
    .where('workspace_id', '=', workspaceId)
    .execute();

describe('perception enqueue', () => {
  it('queues one classification per naming perceived answer, never on re-derive, no mention or an unperceived audit', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    const naming = await analysed(tenant, auditId, ANSWER);
    await naming.derive();
    await analysed(tenant, auditId, 'Nobody tracked is named here.');
    const unperceived = await fixtures.audit(tenant, {
      configuration: { ...configuration, perception: null },
      scope: 'commerce',
    });
    await analysed(tenant, unperceived, ANSWER);
    const rows = await queued(tenant.workspaceId);
    expect(rows.map((row) => [row.payload, row.idempotency_key, row.max_attempts])).toEqual([
      [
        { analysis_id: naming.analysisId },
        `analytics:answer_perception:${naming.analysisId}:perception-extract-test`,
        policy.perception.task_max_attempts,
      ],
    ]);
  });
});

describe('perception executor', () => {
  it("persists verified quotes with code-point offsets, classifies against the project's own themes and counts what it dropped", async () => {
    const value = randomUUID();
    const theme = (owner: Tenant, id: string, name: string) => ({
      id,
      workspace_id: owner.workspaceId,
      project_id: owner.projectId,
      name,
      position: 0,
      source: 'research',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const other = await fixtures.tenant();
    await db
      .insertInto('project_themes')
      .values([theme(tenant, value, 'Value'), theme(other, randomUUID(), 'Support')])
      .execute();
    const auditId = await fixtures.audit(tenant, { configuration });
    const { analysisId } = await analysed(tenant, auditId, ANSWER);
    const gateway = fakeGateway([goodOutput]);
    await drain(tenant, gateway.factory);
    const sent = JSON.stringify(gateway.fetch.mock.calls);
    expect(sent).toContain('Allowed themes: Value, Other\\\\n');
    expect(await perceptions(tenant.workspaceId)).toEqual([
      {
        analysis_id: analysisId,
        outcome: 'classified',
        outcome_reason: null,
        extractor_version: 'perception-extract-test',
        drop_counts: { quote_not_found: 1, theme_other: 1 },
        usage: expect.objectContaining({ input_tokens: 100, output_tokens: 20, attempts: 1 }),
        model: 'returned-model',
      },
    ]);
    const entities = await db
      .selectFrom('entity_sentiments')
      .select(['entity_id', 'label', 'low_confidence', 'aspects'])
      .where('workspace_id', '=', tenant.workspaceId)
      .orderBy('entity_id')
      .execute();
    expect(entities).toEqual([
      {
        entity_id: 'brand:acme',
        label: 'positive',
        low_confidence: false,
        aspects: [
          {
            theme_id: value,
            polarity: 'positive',
            quote: 'the best value pick',
            start: 10,
            end: 29,
          },
        ],
      },
      {
        entity_id: 'competitor:rival',
        label: 'negative',
        low_confidence: false,
        aspects: [
          {
            theme_id: null,
            polarity: 'negative',
            quote: 'Rival support is slow',
            start: 31,
            end: 52,
          },
        ],
      },
    ]);
    expect([...ANSWER].slice(10, 29).join('')).toBe('the best value pick');
    const [task] = await queued(tenant.workspaceId);
    expect(task?.status).toBe('succeeded');
  });

  it('settles as unavailable when no gateway model is configured', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    await analysed(tenant, auditId, ANSWER);
    await drain(tenant, () => null);
    expect(
      (await perceptions(tenant.workspaceId)).map((row) => [row.outcome, row.outcome_reason]),
    ).toEqual([['unavailable', 'model_not_configured']]);
    expect((await queued(tenant.workspaceId)).map((row) => row.status)).toEqual(['succeeded']);
  });

  it('never classifies an audit with a model other than the one it froze', async () => {
    const auditId = await fixtures.audit(tenant, {
      configuration: {
        ...configuration,
        perception: { ...configuration.perception, model: 'frozen-model' },
      },
    });
    await analysed(tenant, auditId, ANSWER);
    const gateway = fakeGateway([goodOutput]);
    await drain(tenant, gateway.factory);
    expect(
      (await perceptions(tenant.workspaceId)).map((row) => [row.outcome, row.outcome_reason]),
    ).toEqual([['unavailable', 'model_changed']]);
    expect(gateway.fetch).not.toHaveBeenCalled();
  });

  it('ends over the per-audit cap as platform_cap without failing the task or the audit', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    await analysed(tenant, auditId, ANSWER);
    await analysed(tenant, auditId, `${ANSWER} Again.`);
    const gateway = fakeGateway([goodOutput, goodOutput]);
    await drain(tenant, gateway.factory, {
      ...policy.perception,
      max_classifications_per_audit: 1,
    });
    const outcomes = (await perceptions(tenant.workspaceId)).map(
      (row) => row.outcome_reason ?? row.outcome,
    );
    expect(outcomes.toSorted()).toEqual(['classified', 'platform_cap']);
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
    expect((await queued(tenant.workspaceId)).map((row) => row.status)).toEqual([
      'succeeded',
      'succeeded',
    ]);
    const audit = await db
      .selectFrom('audits')
      .select('status')
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow();
    expect(audit.status).toBe('completed');
  });

  it('retries an unparseable output once, then records invalid_output', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    await analysed(tenant, auditId, ANSWER);
    const gateway = fakeGateway(['not json', '{"entities": "nope"}', goodOutput]);
    await drain(tenant, gateway.factory);
    expect((await perceptions(tenant.workspaceId)).map((row) => [row.outcome, row.usage])).toEqual([
      ['invalid_output', { attempts: 2 }],
    ]);
    expect(gateway.fetch).toHaveBeenCalledTimes(2);
  });

  it('recovers an expired lease and classifies; an exhausted task is compensated as task_failed', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    const live = await analysed(tenant, auditId, ANSWER);
    const dead = await analysed(tenant, auditId, `${ANSWER} Twice.`);
    const tasks = await queued(tenant.workspaceId);
    const expired = new Date(Date.now() - 60_000);
    for (const task of tasks) {
      const exhausted = JSON.stringify(task.payload).includes(dead.analysisId);
      await db
        .updateTable('analytics_tasks')
        .set({
          status: 'running',
          lease_owner: 'crashed-worker',
          lease_expires_at: expired,
          attempt_count: exhausted ? task.max_attempts - 1 : 0,
        })
        .where('id', '=', task.id)
        .execute();
    }
    await drain(tenant, fakeGateway([goodOutput]).factory);
    const outcomes = Object.fromEntries(
      (await perceptions(tenant.workspaceId)).map((row) => [
        row.analysis_id,
        row.outcome_reason ?? row.outcome,
      ]),
    );
    expect(outcomes).toEqual({ [live.analysisId]: 'classified', [dead.analysisId]: 'task_failed' });
  });

  it('never reads or writes another workspace through a forged payload', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    const victim = await analysed(tenant, auditId, ANSWER);
    const attacker = await fixtures.tenant();
    await db
      .insertInto('analytics_tasks')
      .values({
        id: randomUUID(),
        workspace_id: attacker.workspaceId,
        project_id: attacker.projectId,
        task_kind: 'answer_perception',
        payload: JSON.stringify({ analysis_id: victim.analysisId }),
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
    const gateway = fakeGateway([goodOutput]);
    await drain(attacker, gateway.factory);
    expect(gateway.fetch).not.toHaveBeenCalled();
    expect(await perceptions(tenant.workspaceId)).toEqual([]);
    expect((await queued(attacker.workspaceId)).map((row) => row.status)).toEqual(['failed']);
  });
});

describe('untracked business names', () => {
  const NAMING = 'Acme is the best value pick. Ledgerly and Rival Co are cheaper.';
  const naming = (names: unknown) =>
    JSON.stringify({
      entities: [
        { entity_id: 'brand:acme', label: 'positive', confidence: 0.9, aspects: [] },
        { entity_id: 'competitor:rival', label: 'neutral', confidence: 0.9, aspects: [] },
      ],
      untracked_businesses: names,
    });
  const labelled = naming(['Ledgerly', ' ledgerly ', 'Rival Co', 'Invented Corp', 'x'.repeat(81)]);

  const candidates = (auditId: string) =>
    db
      .selectFrom('observed_entity_candidates')
      .select(['id', 'kind', 'name', 'name_key', 'domain', 'prompt_count', 'engine_count'])
      .select(['engine_total', 'source_analysis_ids', 'status'])
      .where('audit_id', '=', auditId)
      .execute();

  async function perceive(auditId: string, engine: string, promptIndex: number) {
    const { analysisId } = await analysed(tenant, auditId, NAMING, { engine, promptIndex });
    await drain(tenant, fakeGateway([labelled]).factory);
    return analysisId;
  }

  it('keeps verified untracked names per answer and suggests one past the prompt and engine counts', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    const first = await perceive(auditId, 'chatgpt', 0);
    const second = await perceive(auditId, 'perplexity', 1);
    const [perception] = await perceptions(tenant.workspaceId);
    expect(perception?.drop_counts).toEqual({
      name_duplicate: 1,
      name_tracked: 1,
      name_not_found: 1,
      name_too_long: 1,
    });
    const observed = await db
      .selectFrom('answer_untracked_names')
      .select(['analysis_id', 'name', 'name_key'])
      .where('audit_id', '=', auditId)
      .orderBy('created_at')
      .execute();
    expect(observed).toEqual([
      { analysis_id: first, name: 'Ledgerly', name_key: 'ledgerly' },
      { analysis_id: second, name: 'Ledgerly', name_key: 'ledgerly' },
    ]);
    expect(await candidates(auditId)).toEqual([]);

    const third = await perceive(auditId, 'chatgpt', 2);
    const [candidate] = await candidates(auditId);
    expect(candidate).toEqual({
      id: expect.any(String),
      kind: 'named_in_answers',
      name: 'Ledgerly',
      name_key: 'ledgerly',
      domain: null,
      prompt_count: 3,
      engine_count: 2,
      engine_total: 2,
      source_analysis_ids: [first, second, third].sort(),
      status: 'pending',
    });

    await rejectSuggestion(
      db,
      { workspaceId: tenant.workspaceId, projectId: tenant.projectId, userId: tenant.userId },
      candidate!.id,
    );
    const later = await fixtures.audit(tenant, { configuration });
    for (const [engine, prompt] of [
      ['chatgpt', 0],
      ['perplexity', 1],
      ['gemini', 2],
    ] as const)
      await perceive(later, engine, prompt);
    expect(
      await db
        .selectFrom('answer_untracked_names')
        .select('id')
        .where('audit_id', '=', later)
        .execute(),
    ).toHaveLength(3);
    expect(await candidates(later)).toEqual([]);
  });

  it('reads a missing name list as unknown and a malformed one as unusable output', async () => {
    const auditId = await fixtures.audit(tenant, { configuration });
    await analysed(tenant, auditId, NAMING);
    await drain(tenant, fakeGateway([naming(undefined)]).factory);
    expect(await perceptions(tenant.workspaceId)).toEqual([
      expect.objectContaining({ outcome: 'classified', drop_counts: { names_missing: 1 } }),
    ]);

    await analysed(tenant, auditId, `${NAMING} Again.`);
    await drain(tenant, fakeGateway([naming('Ledgerly'), naming([7])]).factory);
    expect((await perceptions(tenant.workspaceId)).map((row) => row.outcome).toSorted()).toEqual([
      'classified',
      'invalid_output',
    ]);
    const names = await db
      .selectFrom('answer_untracked_names')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(names).toEqual([]);
  });
});
