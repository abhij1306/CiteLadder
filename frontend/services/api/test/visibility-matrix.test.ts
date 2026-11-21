import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import type { Json, Tenant } from './visibility-fixtures.ts';
import { topic } from './prompt-fixtures.ts';
import { frozen, route, visibilityReads } from './visibility-read-support.ts';

const { db, fixtures, get, newMarket } = visibilityReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const VERSIONS = {
  extractor_version: 'perception-extract-test',
  template_version: 'perception-template-test',
  metrics_version: 'perception-metrics-test',
  model: 'test',
};

function slice(input: {
  answers: number;
  brand: number;
  globex: number;
  position: number | null;
  wins: { answers: number; brand: number };
}): Record<string, unknown> {
  return {
    total_completed: input.answers,
    brand_mention_count: input.brand,
    brand_mention_rate: input.brand / input.answers,
    owned_citation_rate: 0,
    competitor_mention_rate: { Globex: input.globex / input.answers },
    competitor_citation_rate: { Globex: 0 },
    share_of_voice: { mention_counts: { 'Acme Corp': input.brand, Globex: input.globex } },
    average_positions: { 'Acme Corp': input.position, Globex: input.globex ? 2 : null },
    win_tally: {
      answers: input.wins.answers,
      first: { 'Acme Corp': input.wins.brand, Globex: input.wins.answers - input.wins.brand },
    },
  };
}

const chatgpt = slice({
  answers: 4,
  brand: 2,
  globex: 2,
  position: 1.5,
  wins: { answers: 3, brand: 1 },
});
const perplexity = slice({
  answers: 2,
  brand: 0,
  globex: 1,
  position: null,
  wins: { answers: 1, brand: 0 },
});
const gemini = slice({
  answers: 1,
  brand: 0,
  globex: 0,
  position: null,
  wins: { answers: 0, brand: 0 },
});

async function run(tenant: Tenant, metrics: Record<string, unknown>) {
  const auditId = await fixtures.audit(tenant, {
    completedAt: new Date('2026-05-01T00:00:00Z'),
    configuration: frozen({ perception: VERSIONS }),
  });
  await fixtures.metricSnapshot(tenant, auditId, { metrics: metrics as Json });
  return auditId;
}

async function topicBlock(tenant: Tenant, auditId: string, topicId: string, metrics: unknown) {
  await db
    .insertInto('audit_topic_metrics')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      audit_id: auditId,
      topic_id: topicId,
      topic_name: 'Pricing',
      visibility_score: 0,
      metrics: JSON.stringify(metrics),
      source_analysis_ids: '[]',
      analyzer_version: 'test',
      created_at: new Date(),
    })
    .execute();
}

async function perceived(
  tenant: Tenant,
  auditId: string,
  entity: 'brand' | 'competitor',
  label: string,
) {
  const name = entity === 'brand' ? 'Acme Corp' : 'Globex';
  const entityId = `${entity}:${name}`;
  const { taskId, analysisId } = await fixtures.execution(tenant, {
    auditId,
    engine: 'chatgpt',
    analysis: {},
  });
  await db
    .updateTable('response_analyses')
    .set({
      entity_assessments: JSON.stringify([
        { entity_id: entityId, entity_name: name, entity_kind: entity, state: 'mentioned' },
      ]),
    })
    .where('id', '=', analysisId!)
    .execute();
  const { artifact_id } = await db
    .selectFrom('response_analyses')
    .select('artifact_id')
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
      artifact_id,
      extractor_version: VERSIONS.extractor_version,
      template_version: VERSIONS.template_version,
      outcome: 'classified',
      outcome_reason: null,
      created_at: new Date(),
    })
    .execute();
  await db
    .insertInto('entity_sentiments')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      perception_id: perceptionId,
      entity_id: entityId,
      entity_name: name,
      entity_kind: entity,
      label,
      confidence: 0.9,
      low_confidence: false,
      passage_spans: JSON.stringify([]),
      aspects: JSON.stringify([]),
    })
    .execute();
}

type Matrix = {
  axes: Record<string, Record<string, unknown>[]>;
  grids: Record<string, Record<string, unknown>[][]>;
  rankings: Record<string, Record<string, unknown>[]>;
};

describe('GET /visibility/matrix', () => {
  it('serves each metric per cell, and keeps not run apart from not measured', async () => {
    const tenant = await fixtures.tenant();
    await fixtures.brand(tenant.projectId, 'Acme Corp');
    await fixtures.competitor(tenant.projectId, { name: 'Globex', domains: ['globex.example'] });
    const pricing = await topic(db, tenant.projectId, 'Pricing & plans');
    const onboarding = await topic(db, tenant.projectId, 'Onboarding');
    const uk = await newMarket(tenant);
    const whole = slice({
      answers: 7,
      brand: 2,
      globex: 3,
      position: 1.5,
      wins: { answers: 4, brand: 1 },
    });
    const auditId = await run(tenant, { ...whole, per_engine: { chatgpt, perplexity, gemini } });
    await topicBlock(tenant, auditId, pricing, { ...chatgpt, per_engine: { chatgpt } });
    await perceived(tenant, auditId, 'brand', 'positive');
    await perceived(tenant, auditId, 'brand', 'negative');
    await perceived(tenant, auditId, 'brand', 'positive');

    const { status, body } = await get(tenant, route(tenant, '/matrix'));
    expect(status).toBe(200);
    const { axes, grids, rankings } = body as unknown as Matrix;
    expect(axes.engine).toEqual([
      { logical_engine: 'chatgpt', answers: 4 },
      { logical_engine: 'perplexity', answers: 2 },
      { logical_engine: 'gemini', answers: 1 },
    ]);
    expect(axes.topic).toEqual([
      { topic_id: pricing, name: 'Pricing & plans', renamed_from: 'Pricing', answers: 4 },
      { topic_id: onboarding, name: 'Onboarding', renamed_from: null, answers: 0 },
    ]);
    expect(axes.market?.map((m) => [m.label, m.answers])).toEqual([
      ['United States · English', 7],
      ['United Kingdom', 0],
    ]);
    expect(axes.brand?.map((b) => [b.name, b.is_brand])).toEqual([
      ['Acme Corp', true],
      ['Globex', false],
    ]);

    const engineBrand = grids.engine_brand!;
    expect(engineBrand[0]![0]).toEqual({
      kind: 'measured',
      answers: 4,
      mention_rate: 0.5,
      share_of_voice: 0.5,
      avg_position: 1.5,
      win_rate: 1 / 3,
      sentiment: {
        mentions: 3,
        classified: 3,
        positive: 2,
        negative: 1,
        net_sentiment: expect.closeTo(33.33, 2),
      },
    });
    expect(engineBrand[1]![1]).toMatchObject({
      mention_rate: 0.5,
      share_of_voice: 1,
      avg_position: 2,
      win_rate: 1,
    });
    expect(engineBrand[1]![0]).toMatchObject({
      mention_rate: 0,
      avg_position: null,
      win_rate: 0,
      sentiment: { mentions: 0, classified: 0, net_sentiment: null },
    });
    expect(engineBrand[2]![0]).toMatchObject({ answers: 1, win_rate: null });
    expect(grids.engine_topic!.map((row) => row.map((c) => c.kind))).toEqual([
      ['measured', 'not_run'],
      ['not_run', 'not_run'],
      ['not_run', 'not_run'],
    ]);
    expect(grids.engine_market![0]!.map((c) => c.kind)).toEqual(['measured', 'not_run']);
    expect(rankings.engine![1]).toEqual({
      kind: 'measured',
      leaders: [
        {
          name: 'Globex',
          is_brand: false,
          logo_url: null,
          website_url: 'https://globex.example',
          mention_rate: 0.5,
        },
        {
          name: 'Acme Corp',
          is_brand: true,
          logo_url: null,
          website_url: 'https://acme.example',
          mention_rate: 0,
        },
      ],
    });
    expect(rankings.topic![1]).toEqual({ kind: 'not_run' });

    const narrowed = (await get(tenant, route(tenant, '/matrix'), { engine: 'chatgpt' }))
      .body as unknown as Matrix;
    expect(narrowed.axes.engine).toEqual([{ logical_engine: 'chatgpt', answers: 4 }]);
    expect(narrowed.grids.market_brand![0]![1]).toMatchObject({ answers: 4, share_of_voice: 0.5 });

    const ukRun = await run(tenant, { ...gemini, per_engine: { gemini } });
    await db.updateTable('audits').set({ market_id: uk }).where('id', '=', ukRun).execute();
    const named = (
      await get(tenant, route(tenant, '/matrix'), { selection_mode: 'run', audit_id: ukRun })
    ).body as unknown as Matrix;
    expect(named.axes.market?.map((m) => [m.label, m.answers])).toEqual([
      ['United States · English', 7],
      ['United Kingdom', 1],
    ]);
  });

  it('caps an axis at ten items, the most answered first', async () => {
    const tenant = await fixtures.tenant();
    const base = slice({
      answers: 1,
      brand: 1,
      globex: 0,
      position: 1,
      wins: { answers: 1, brand: 1 },
    });
    const auditId = await run(tenant, { ...base, per_engine: { chatgpt: base } });
    for (let answers = 1; answers <= 12; answers++) {
      const id = await topic(db, tenant.projectId, `Topic ${answers}`);
      await topicBlock(tenant, auditId, id, { ...base, total_completed: answers });
    }
    const { body } = await get(tenant, route(tenant, '/matrix'));
    const items = (body as unknown as Matrix).axes.topic!;
    expect(items.map((item) => item.answers)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it("reads only the reader's workspace", async () => {
    const tenant = await fixtures.tenant();
    const base = slice({
      answers: 1,
      brand: 1,
      globex: 0,
      position: 1,
      wins: { answers: 1, brand: 1 },
    });
    await run(tenant, { ...base, per_engine: { chatgpt: base } });
    const other = await fixtures.tenant();
    expect((await get(other, route(tenant, '/matrix'))).status).toBe(404);
    expect((await get(tenant, route(tenant, '/matrix'))).status).toBe(200);
  });
});
