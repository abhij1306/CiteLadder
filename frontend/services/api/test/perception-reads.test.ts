/**
 * Answer perception reads over HTTP: the selection summary and its states,
 * paged quotes, the execution evidence label, and workspace isolation.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new VisibilityFixtures(db);
const app = createApp(config, db);
const VERSIONS = {
  extractor_version: 'perception-extract-test',
  template_version: 'perception-template-test',
  metrics_version: 'perception-metrics-test',
};
const CONFIGURATION = {
  brand_name: 'Acme',
  competitors: [{ name: 'Rival', domains: [] }],
  perception: VERSIONS,
};

type Body = Record<string, unknown>;

async function get(tenant: Tenant, path: string, query: Record<string, string> = {}) {
  const token = await sessionToken({ sub: tenant.userId, ver: 0 });
  const search = new URLSearchParams(query);
  const response = await app.request(`${path}${search.size ? `?${search}` : ''}`, {
    headers: { cookie: `${TEST_SESSION_COOKIE}=${token}` },
  });
  return { status: response.status, body: (await response.json()) as Body };
}

type Entity = {
  name: string;
  kind: 'brand' | 'competitor';
  state?: string;
  label?: string;
  confidence?: number;
  aspects?: { theme: string; polarity: string; quote: string; start: number; end: number }[];
};

/** One analysed answer and, unless `outcome` is omitted, its persisted perception. */
async function answer(
  tenant: Tenant,
  auditId: string,
  input: {
    entities: Entity[];
    outcome?: string;
    reason?: string;
    citations?: string[];
    engine?: string;
  },
) {
  const { taskId, analysisId } = await fixtures.execution(tenant, {
    auditId,
    engine: input.engine,
    promptText: 'best tools?',
    theme: 'Tools',
    analysis: { citations: (input.citations ?? []).map((url) => ({ url })) },
  });
  await db
    .updateTable('response_analyses')
    .set({
      entity_assessments: JSON.stringify(
        input.entities.map((entity) => ({
          entity_id: `${entity.kind}:${entity.name.toLowerCase()}`,
          entity_name: entity.name,
          entity_kind: entity.kind,
          state: entity.state ?? 'mentioned',
        })),
      ),
    })
    .where('id', '=', analysisId!)
    .execute();
  if (!input.outcome) return taskId;
  const analysis = await db
    .selectFrom('response_analyses')
    .select(['artifact_id'])
    .where('id', '=', analysisId!)
    .executeTakeFirstOrThrow();
  const perceptionId = randomUUID();
  await db
    .insertInto('answer_perceptions')
    .values({
      id: perceptionId,
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      audit_id: auditId,
      task_id: taskId,
      analysis_id: analysisId!,
      artifact_id: analysis.artifact_id,
      extractor_version: VERSIONS.extractor_version,
      template_version: VERSIONS.template_version,
      outcome: input.outcome,
      outcome_reason: input.reason ?? null,
      created_at: new Date(),
    })
    .execute();
  const labelled = input.entities.filter((entity) => entity.label);
  if (labelled.length)
    await db
      .insertInto('entity_sentiments')
      .values(
        labelled.map((entity) => ({
          id: randomUUID(),
          workspace_id: tenant.workspaceId,
          perception_id: perceptionId,
          entity_id: `${entity.kind}:${entity.name.toLowerCase()}`,
          entity_name: entity.name,
          entity_kind: entity.kind,
          label: entity.label!,
          confidence: entity.confidence ?? 0.9,
          low_confidence: (entity.confidence ?? 0.9) < 0.6,
          passage_spans: JSON.stringify([]),
          aspects: JSON.stringify(entity.aspects ?? []),
        })),
      )
      .execute();
  return taskId;
}

const aspect = (polarity: string, quote: string, start = 0) => ({
  theme: 'support',
  polarity,
  quote,
  start,
  end: start + quote.length,
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('GET /visibility/perception', () => {
  let tenant: Tenant;
  let auditId: string;
  let classifiedTask: string;

  beforeAll(async () => {
    tenant = await fixtures.tenant();
    auditId = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    classifiedTask = await answer(tenant, auditId, {
      outcome: 'classified',
      citations: ['https://reviews.example/acme'],
      entities: [
        {
          name: 'Acme',
          kind: 'brand',
          label: 'negative',
          aspects: [aspect('negative', 'Acme support is slow')],
        },
        { name: 'Rival', kind: 'competitor', label: 'positive' },
      ],
    });
    await answer(tenant, auditId, {
      outcome: 'classified',
      entities: [
        {
          name: 'Acme',
          kind: 'brand',
          state: 'recommended',
          label: 'positive',
          aspects: [aspect('positive', 'Acme support is great')],
        },
      ],
    });
    await answer(tenant, auditId, {
      outcome: 'classified',
      entities: [{ name: 'Acme', kind: 'brand', label: 'positive', confidence: 0.3 }],
    });
    await answer(tenant, auditId, { entities: [{ name: 'Acme', kind: 'brand' }] });
    await answer(tenant, auditId, {
      outcome: 'unavailable',
      reason: 'platform_cap',
      entities: [{ name: 'Acme', kind: 'brand' }],
    });
    await answer(tenant, auditId, { entities: [{ name: 'Acme', kind: 'brand', state: 'absent' }] });
  });

  it('nets the confident labels and reports every other mention in its coverage bucket', async () => {
    const { status, body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/perception`,
      {
        audit_id: auditId,
      },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      state: 'value',
      reason: null,
      source_audit_ids: [auditId],
      coverage: {
        mentions: 5,
        classified: 2,
        pending: 1,
        not_assessable: 0,
        low_confidence: 1,
        unavailable: [{ reason: 'platform_cap', count: 1 }],
      },
      brand: { name: 'Acme', score: { positive: 1, negative: 1, classified: 2, net_sentiment: 0 } },
      themes: [{ theme: 'support', positive: 1, negative: 1 }],
      drivers: [
        { domain: 'reviews.example', answers: 1, example_url: 'https://reviews.example/acme' },
      ],
      recommended: { mentioned: 5, recommended: 1, recommended_against: 0, rate: 0.2 },
    });
    expect(body.entities).toEqual([
      expect.objectContaining({ name: 'Acme', is_brand: true }),
      expect.objectContaining({
        name: 'Rival',
        is_brand: false,
        score: expect.objectContaining({ net_sentiment: 100 }),
      }),
    ]);
    expect(body.negative_quotes).toEqual([
      expect.objectContaining({
        text: 'Acme support is slow',
        run_id: auditId,
        execution_id: classifiedTask,
      }),
    ]);
  });

  it('reads pending before any classification lands, then unavailable with its reason', async () => {
    const pendingRun = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    await answer(tenant, pendingRun, { entities: [{ name: 'Acme', kind: 'brand' }] });
    const capped = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    await answer(tenant, capped, {
      outcome: 'unavailable',
      reason: 'model_not_configured',
      entities: [{ name: 'Acme', kind: 'brand' }],
    });
    const silent = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    await answer(tenant, silent, { entities: [{ name: 'Acme', kind: 'brand', state: 'absent' }] });
    const states = [];
    for (const run of [pendingRun, capped, silent]) {
      const { body } = await get(
        tenant,
        `/api/v1/projects/${tenant.projectId}/visibility/perception`,
        {
          audit_id: run,
        },
      );
      states.push([body.state, body.reason, (body.brand as Body | null)?.score ?? null]);
    }
    expect(states).toEqual([
      ['pending', null, expect.objectContaining({ net_sentiment: null, classified: 0 })],
      ['unavailable', 'model_not_configured', expect.objectContaining({ net_sentiment: null })],
      ['no_mentions', null, null],
    ]);
  });

  it('pages verified quotes with a cursor and filters by polarity', async () => {
    const path = `/api/v1/projects/${tenant.projectId}/visibility/perception/quotes`;
    const first = await get(tenant, path, { audit_id: auditId, limit: '1' });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    const second = await get(tenant, path, {
      audit_id: auditId,
      limit: '1',
      cursor: String(first.body.next_cursor),
    });
    const texts = [first.body.items, second.body.items].flat().map((item) => (item as Body).text);
    expect(texts.toSorted()).toEqual(['Acme support is great', 'Acme support is slow']);
    expect(second.body.next_cursor).toBeNull();
    const negative = await get(tenant, path, { audit_id: auditId, polarity: 'negative' });
    expect((negative.body.items as Body[]).map((item) => item.text)).toEqual([
      'Acme support is slow',
    ]);
    const replay = await get(tenant, path, {
      audit_id: auditId,
      polarity: 'positive',
      cursor: String(first.body.next_cursor),
    });
    expect(replay.status).toBe(422);
  });

  it('labels each named business on the execution evidence', async () => {
    const { body } = await get(tenant, `/api/v1/executions/${classifiedTask}`);
    expect(body.perception).toEqual([
      {
        entity: 'Acme',
        is_brand: true,
        state: 'classified',
        reason: null,
        label: 'negative',
        confidence: 0.9,
        extractor_version: VERSIONS.extractor_version,
        template_version: VERSIONS.template_version,
        aspects: [aspect('negative', 'Acme support is slow')],
      },
      {
        entity: 'Rival',
        is_brand: false,
        state: 'classified',
        reason: null,
        label: 'positive',
        confidence: 0.9,
        extractor_version: VERSIONS.extractor_version,
        template_version: VERSIONS.template_version,
        aspects: [],
      },
    ]);
  });

  it('is not found from another workspace', async () => {
    const outsider = await fixtures.tenant();
    const summary = await get(
      outsider,
      `/api/v1/projects/${tenant.projectId}/visibility/perception`,
      {
        audit_id: auditId,
      },
    );
    const quotes = await get(
      outsider,
      `/api/v1/projects/${outsider.projectId}/visibility/perception/quotes`,
      {
        audit_id: auditId,
      },
    );
    const evidence = await get(outsider, `/api/v1/executions/${classifiedTask}`);
    expect([summary.status, quotes.status, evidence.status]).toEqual([404, 404, 404]);
  });
});
