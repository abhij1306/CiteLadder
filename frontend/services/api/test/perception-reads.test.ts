import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { perceivedAnswers, sentimentsOf } from '../src/visibility/perception.ts';
import {
  aspect,
  CONFIGURATION,
  PRICING,
  perceptionReads,
  SUPPORT,
  type Body,
  VERSIONS,
} from './perception-read-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';
import { frozen } from './visibility-read-support.ts';

const { db, fixtures, get, answer, themes } = perceptionReads();

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
    await themes(tenant, [
      [SUPPORT, 'Support'],
      [PRICING, 'Pricing'],
    ]);
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
      themes: [{ theme: 'Support', positive: 1, negative: 1 }],
      drivers: [
        { domain: 'reviews.example', answers: 1, example_url: 'https://reviews.example/acme' },
      ],
      recommended: { mentioned: 5, recommended: 1, recommended_against: 0, rate: 0.2 },
    });
    expect(body.entities).toEqual([
      expect.objectContaining({
        name: 'Acme',
        is_brand: true,
        theme_mentions: [{ theme: 'Support', mentions: 2 }],
      }),
      expect.objectContaining({
        name: 'Rival',
        is_brand: false,
        score: expect.objectContaining({ net_sentiment: 100 }),
        theme_mentions: [],
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

  it('counts competitor themes per mention while its quotes stay out of the brand’s (AV-6)', async () => {
    const run = await fixtures.audit(tenant, { configuration: CONFIGURATION });
    await answer(tenant, run, {
      outcome: 'classified',
      entities: [
        { name: 'Acme', kind: 'brand', label: 'positive' },
        {
          name: 'Rival',
          kind: 'competitor',
          label: 'negative',
          aspects: [
            aspect('negative', 'Rival support is slow'),
            aspect('negative', 'Rival support is rude', 30),
            { ...aspect('positive', 'Rival is cheap'), theme_id: PRICING },
          ],
        },
      ],
    });
    await answer(tenant, run, {
      outcome: 'classified',
      entities: [
        {
          name: 'Rival',
          kind: 'competitor',
          label: 'negative',
          aspects: [aspect('negative', 'x')],
        },
      ],
    });
    const { body } = await get(
      tenant,
      `/api/v1/projects/${tenant.projectId}/visibility/perception`,
      { audit_id: run },
    );
    expect([
      (body.entities as Body[]).map((entity) => [entity.name, entity.theme_mentions]),
      body.themes,
      body.negative_quotes,
    ]).toEqual([
      [
        ['Acme', []],
        [
          'Rival',
          [
            { theme: 'Support', mentions: 2 },
            { theme: 'Pricing', mentions: 1 },
          ],
        ],
      ],
      [],
      [],
    ]);
    const rival = async () =>
      (
        (
          await get(tenant, `/api/v1/projects/${tenant.projectId}/visibility/perception`, {
            audit_id: run,
          })
        ).body.entities as Body[]
      ).find((entity) => entity.name === 'Rival')?.theme_mentions;
    await db
      .updateTable('project_themes')
      .set({ name: 'Price' })
      .where('id', '=', PRICING)
      .execute();
    const renamed = await rival();
    await db.deleteFrom('project_themes').where('id', '=', PRICING).execute();
    expect([renamed, await rival()]).toEqual([
      [
        { theme: 'Support', mentions: 2 },
        { theme: 'Price', mentions: 1 },
      ],
      [
        { theme: 'Support', mentions: 2 },
        { theme: 'Other', mentions: 1 },
      ],
    ]);
  });

  it('serves each ranking row and prompt its net sentiment over the same counts', async () => {
    await fixtures.metricSnapshot(tenant, auditId, {
      metrics: {
        total_completed: 6,
        share_of_voice: { mention_counts: { Acme: 5, Rival: 1 } },
        competitor_mention_rate: { Rival: 1 / 6, Ghost: 0 },
      },
    });
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 0,
      promptText: 'best tools?',
      composite: 50,
    });
    const base = `/api/v1/projects/${tenant.projectId}/visibility`;
    const ranking = await get(tenant, base, { audit_id: auditId });
    const prompts = await get(tenant, `${base}/prompts`, { audit_id: auditId });
    const trend = await get(tenant, `${base}/trends`);
    expect(ranking.status).toBe(200);
    const sentiments = (rows: unknown) => (rows as Body[]).map((row) => [row.name, row.sentiment]);
    const expected = [
      ['Acme', { mentions: 5, classified: 2, positive: 1, negative: 1, net_sentiment: 0 }],
      ['Rival', { mentions: 1, classified: 1, positive: 1, negative: 0, net_sentiment: 100 }],
      ['Ghost', { mentions: 0, classified: 0, positive: 0, negative: 0, net_sentiment: null }],
    ];
    expect(sentiments(ranking.body.rankings)).toEqual(expected);
    const point = (trend.body as unknown as Body[]).find((row) => row.audit_id === auditId);
    expect(sentiments(point?.rankings)).toEqual(expected);
    expect((prompts.body as unknown as Body[])[0]!.sentiment).toEqual({
      mentions: 1,
      classified: 1,
      positive: 0,
      negative: 1,
      net_sentiment: -100,
    });
  });

  it('leaves a pool with a run admitted without perception unknown, not a partial sentiment', async () => {
    const unperceived = await fixtures.audit(tenant, {
      configuration: { ...CONFIGURATION, perception: undefined },
    });
    await answer(tenant, unperceived, { entities: [{ name: 'Acme', kind: 'brand' }] });
    const pool = async (auditIds: string[]) => {
      const answers = await perceivedAnswers(db, {
        workspaceId: tenant.workspaceId,
        projectId: tenant.projectId,
        marketId: null,
        auditId: null,
        auditIds,
        logicalEngine: null,
        cohort: 'all',
        fromAt: null,
        toAt: null,
      });
      return answers && sentimentsOf(answers).map((entity) => entity.name);
    };
    const [perceivedOnly, mixed] = [await pool([auditId]), await pool([auditId, unperceived])];
    expect([perceivedOnly, mixed]).toEqual([['Acme', 'Rival'], null]);
    await fixtures.promptScore(tenant, unperceived, {
      promptIndex: 0,
      promptText: 'best tools?',
      composite: 50,
    });
    const pooledPrompt = async (ids: string[]) => {
      const search = new URLSearchParams(ids.map((id) => ['audit_ids', id]));
      const { body } = await get(
        tenant,
        `/api/v1/projects/${tenant.projectId}/visibility/prompts?${search}`,
      );
      return (body as unknown as Body[]).map((row) => row.sentiment);
    };
    expect([await pooledPrompt([auditId]), await pooledPrompt([auditId, unperceived])]).toEqual([
      [{ mentions: 1, classified: 1, positive: 0, negative: 1, net_sentiment: -100 }],
      [null],
    ]);
  });

  it('serves brand-question answers under the branded and all selections only (AV-24)', async () => {
    const own = await fixtures.tenant();
    const run = await fixtures.audit(own, { configuration: CONFIGURATION });
    await answer(own, run, {
      outcome: 'classified',
      entities: [{ name: 'Acme', kind: 'brand', label: 'positive' }],
    });
    await answer(own, run, {
      outcome: 'classified',
      cohort: 'brand_diagnostic',
      entities: [{ name: 'Acme', kind: 'brand', label: 'negative' }],
    });
    const brandScore = async (cohort: string) => {
      const { body } = await get(own, `/api/v1/projects/${own.projectId}/visibility/perception`, {
        audit_id: run,
        cohort,
      });
      const { positive, negative } = (body.brand as { score: Record<string, number> }).score;
      return [cohort, positive, negative];
    };
    expect([
      await brandScore('core'),
      await brandScore('comparison'),
      await brandScore('all'),
    ]).toEqual([
      ['core', 1, 0],
      ['comparison', 0, 1],
      ['all', 1, 1],
    ]);
    const insights = await perceivedAnswers(db, {
      workspaceId: own.workspaceId,
      projectId: own.projectId,
      marketId: null,
      auditId: run,
      auditIds: null,
      logicalEngine: null,
      cohort: 'all',
      fromAt: null,
      toAt: null,
    });
    expect(insights?.length).toBe(1);
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
    const byTheme = async (theme: string) =>
      ((await get(tenant, path, { audit_id: auditId, theme })).body.items as Body[]).length;
    expect([await byTheme('Support'), await byTheme('Delivery')]).toEqual([2, 0]);
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
        aspects: [
          {
            theme: 'Support',
            attribute: { kind: 'not_labelled' },
            polarity: 'negative',
            quote: 'Acme support is slow',
            start: 0,
            end: 20,
          },
        ],
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

  it("trends a pooled period over every measured run in its window, breaking where runs aren't comparable", async () => {
    const period = await fixtures.tenant();
    const outsider = await fixtures.tenant();
    const run = async (owner: Tenant, at: string, panel: string, label: string) => {
      const id = await fixtures.audit(owner, {
        completedAt: new Date(at),
        configuration: { ...frozen({ panel_hash: panel }), ...CONFIGURATION },
      });
      await fixtures.metricSnapshot(owner, id, { metrics: { total_completed: 1 } });
      await answer(owner, id, {
        outcome: 'classified',
        entities: [{ name: 'Acme', kind: 'brand', label }],
      });
      return id;
    };
    await run(period, '2026-03-20T00:00:00Z', 'panel-1', 'negative');
    const pooled = await run(period, '2026-04-02T00:00:00Z', 'panel-1', 'positive');
    const other = await run(period, '2026-04-05T00:00:00Z', 'panel-2', 'negative');
    await run(outsider, '2026-04-03T00:00:00Z', 'panel-1', 'negative');

    const { status, body } = await get(
      period,
      `/api/v1/projects/${period.projectId}/visibility/perception`,
      { audit_ids: pooled, from: '2026-04-01T00:00:00Z', to: '2026-04-08T00:00:00Z' },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      source_audit_ids: [pooled],
      brand: { score: { classified: 1, net_sentiment: 100 } },
    });
    expect(
      (body.trend as { audit_id: string; comparable: boolean }[]).map((point) => [
        point.audit_id,
        point.comparable,
      ]),
    ).toEqual([
      [pooled, true],
      [other, false],
    ]);
  });

  it("counts every answer of each run completed in a date window, and no other run's", async () => {
    const owner = await fixtures.tenant();
    const outsider = await fixtures.tenant();
    const run = async (who: Tenant, at: string, labels: string[]) => {
      const id = await fixtures.audit(who, {
        completedAt: new Date(at),
        configuration: { ...frozen({ panel_hash: at }), ...CONFIGURATION },
      });
      await fixtures.metricSnapshot(who, id, { metrics: { total_completed: labels.length } });
      for (const label of labels)
        await answer(who, id, {
          outcome: 'classified',
          entities: [
            {
              name: 'Acme',
              kind: 'brand',
              label,
              state: label === 'positive' ? 'recommended' : 'mentioned',
              aspects: label === 'neutral' ? [] : [aspect(label, `Acme is ${label} on ${at}`)],
            },
          ],
        });
      return id;
    };
    await run(owner, '2026-05-01T00:00:00Z', ['negative', 'negative', 'negative']);
    const first = await run(owner, '2026-05-10T00:00:00Z', ['positive', 'negative']);
    const second = await run(owner, '2026-05-20T00:00:00Z', ['positive', 'positive', 'neutral']);
    await run(outsider, '2026-05-15T00:00:00Z', ['negative', 'negative']);

    const { status, body } = await get(
      owner,
      `/api/v1/projects/${owner.projectId}/visibility/perception`,
      { from: '2026-05-05T00:00:00Z', to: '2026-05-31T00:00:00Z' },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      state: 'value',
      source_audit_ids: [first, second].sort(),
      coverage: { mentions: 5, classified: 5 },
      brand: {
        score: { positive: 3, neutral: 1, negative: 1, classified: 5, net_sentiment: 40 },
      },
      themes: [{ theme: 'Other', positive: 3, negative: 1 }],
      recommended: { mentioned: 5, recommended: 3, rate: 0.6 },
    });
    expect((body.negative_quotes as { text: string }[]).map((quote) => quote.text)).toEqual([
      'Acme is negative on 2026-05-10T00:00:00Z',
    ]);
    expect((body.trend as { audit_id: string }[]).map((point) => point.audit_id)).toEqual([
      first,
      second,
    ]);
  });

  it('asks for a narrower period when the window holds more runs than one read covers', async () => {
    const owner = await fixtures.tenant();
    const cap = policy.visibility.selection_max_runs;
    const day = (offset: number) => new Date(Date.UTC(2026, 4, 1) + offset * 3_600_000);
    await Promise.all(
      Array.from({ length: cap + 1 }, (_, index) =>
        fixtures.audit(owner, { completedAt: day(index), configuration: CONFIGURATION }),
      ),
    );
    const path = `/api/v1/projects/${owner.projectId}/visibility/perception`;

    const [over, within] = await Promise.all([
      get(owner, path, { from: day(0).toISOString(), to: day(cap).toISOString() }),
      get(owner, path, { from: day(1).toISOString(), to: day(cap).toISOString() }),
    ]);

    expect([over.status, (over.body.error as { message: string }).message]).toEqual([
      422,
      `Select a narrower period: at most ${cap} runs per selection`,
    ]);
    expect(within.status).toBe(200);
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
    const ranking = await get(outsider, `/api/v1/projects/${outsider.projectId}/visibility`, {
      audit_id: auditId,
    });
    expect([summary.status, quotes.status, evidence.status, ranking.status]).toEqual([
      404, 404, 404, 404,
    ]);
  });
});
