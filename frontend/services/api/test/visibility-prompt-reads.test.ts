import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { record } from '../src/db/json.ts';
import { actionRow, snapshotRow } from './opportunity-fixtures.ts';
import { promptSet, prompt as trackedPrompt } from './prompt-fixtures.ts';
import type { Json, Tenant } from './visibility-fixtures.ts';
import { frozen, route, visibilityReads, type Row } from './visibility-read-support.ts';

const { db, fixtures, get, newMarket } = visibilityReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('GET /visibility/prompts', () => {
  it("orders prompts by score and counts each route against that route's own tasks", async () => {
    const tenant = await fixtures.tenant();
    const auditId = await fixtures.audit(tenant, { configuration: frozen() });
    const best = { auditId, promptIndex: 0, promptText: 'best crm' };
    await fixtures.execution(tenant, {
      ...best,
      engine: 'chatgpt',
      transportModel: 'model-a',
      analysis: {
        brandMentioned: true,
        avgPosition: 1,
        searchUsed: true,
        brandMentions: ['Acme Corp'],
        competitorMentions: ['Globex'],
        firstNamed: { kind: 'brand', name: 'Acme Corp' },
      },
    });
    await fixtures.execution(tenant, {
      ...best,
      engine: 'claude',
      transportModel: 'model-b',
      analysis: {
        brandMentioned: false,
        score: { competitors_mentioned: ['Globex'] },
        competitorMentions: ['Globex', 'Initech'],
        firstNamed: { kind: 'competitor', name: 'Globex' },
      },
    });
    await fixtures.execution(tenant, {
      ...best,
      engine: 'gemini',
      transportModel: 'model-a',
      taskStatus: 'failed',
      analysis: null,
    });
    const silent = await fixtures.execution(tenant, {
      auditId,
      promptIndex: 1,
      promptText: 'cheap crm',
    });
    await db
      .updateTable('response_analyses')
      .set({ fanout_state: 'unavailable' })
      .where('id', '=', silent.analysisId!)
      .execute();
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 0,
      promptText: 'best crm',
      composite: 40,
    });
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 1,
      promptText: 'cheap crm',
      composite: 80,
    });

    const { status, body } = await get(tenant, route(tenant, '/prompts'), { audit_id: auditId });

    expect(status).toBe(200);
    expect(body.map((item) => item.prompt_text)).toEqual(['cheap crm', 'best crm']);
    const scored = body[1]!;
    expect(scored).toMatchObject({
      counts: { responses: 2, expected: 3, failed: 1, not_run: 0, brand_responses: 1 },
      visibility_rate: 0.5,
      avg_position: 1,
      win_count: 1,
      win_answers: 2,
      win_rate: 0.5,
      comparison_status: 'no_baseline',
      share_of_voice: 0.25,
      web_search: { searched: 1, reported: 2, share: 0.5 },
      sentiment: null,
    });
    expect([body[0]!.share_of_voice, body[0]!.web_search]).toEqual([
      null,
      { searched: 0, reported: 0, share: null },
    ]);
    expect(scored).toMatchObject({
      mentions: 3,
      brands: [
        { kind: 'competitor', name: 'Globex', responses: 2 },
        { kind: 'brand', name: 'Acme Corp', responses: 1 },
        { kind: 'competitor', name: 'Initech', responses: 1 },
      ],
    });
    expect([body[0]!.mentions, body[0]!.brands]).toEqual([0, []]);
    expect(scored.outcomes).toEqual([
      expect.objectContaining({
        logical_engine: 'chatgpt',
        transport_model: 'model-a',
        counts: expect.objectContaining({ expected: 1, brand_responses: 1 }),
      }),
      expect.objectContaining({
        logical_engine: 'claude',
        gap_counts: { Globex: 1 },
      }),
      expect.objectContaining({
        logical_engine: 'gemini',
        transport_model: 'model-a',
        counts: expect.objectContaining({
          state: 'no_observations',
          responses: 0,
          expected: 1,
          failed: 1,
        }),
        visibility_rate: null,
        answer_states: null,
      }),
    ]);

    const foreignRun = await get(tenant, route(tenant, '/prompts'), { audit_id: randomUUID() });
    expect([foreignRun.status, record(foreignRun.body.error).message]).toEqual([
      404,
      'Audit not found',
    ]);
    const crawl = await fixtures.audit(tenant, { scope: 'site_health' });
    expect((await get(tenant, route(tenant, '/prompts'), { audit_id: crawl })).status).toBe(404);
  });

  it('pools a prompt across a period and drops every single-run score', async () => {
    const tenant = await fixtures.tenant();
    const runs = [];
    for (const [day, brand] of [
      ['2026-03-02', true],
      ['2026-03-09', false],
    ] as const) {
      const auditId = await fixtures.audit(tenant, { completedAt: new Date(`${day}T00:00:00Z`) });
      await fixtures.execution(tenant, {
        auditId,
        promptIndex: 0,
        promptText: 'best crm',
        analysis: {
          brandMentioned: brand,
          brandMentions: brand ? ['Acme Corp'] : [],
          competitorMentions: ['Globex'],
        },
      });
      await fixtures.promptScore(tenant, auditId, {
        promptIndex: 0,
        promptText: 'best crm',
        composite: 50,
      });
      runs.push(auditId);
    }

    const { body } = await get(tenant, route(tenant, '/prompts'), { audit_ids: runs });

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      source_audit_ids: [...runs].sort(),
      composite_score: null,
      rolling_four: [],
      counts: { responses: 2, brand_responses: 1 },
      visibility_rate: 0.5,
      share_of_voice: 1 / 3,
      web_search: { searched: 0, reported: 2, share: 0 },
      mentions: 2,
      brands: [
        { name: 'Globex', responses: 2 },
        { name: 'Acme Corp', responses: 1 },
      ],
    });
  });
  it("reads every prompt's own latest run in its own cohort, with the change since its previous one", async () => {
    const tenant = await fixtures.tenant();
    const outsider = await fixtures.tenant();
    const set = await promptSet(db, tenant.projectId);
    const [older, newer, brandQuestion] = [
      await trackedPrompt(db, set, 'best crm'),
      await trackedPrompt(db, set, 'cheap crm'),
      await trackedPrompt(db, set, 'is acme crm any good'),
    ];
    type Measured = [promptId: string, text: string, cohort?: string];
    const run = async (
      owner: Tenant,
      day: string,
      prompts: Measured[],
      configuration = frozen(),
    ) => {
      const auditId = await fixtures.audit(owner, {
        completedAt: new Date(`${day}T00:00:00Z`),
        configuration,
      });
      for (const [index, [promptId, promptText, cohort = 'core']] of prompts.entries()) {
        await fixtures.execution(owner, {
          auditId,
          promptIndex: index,
          promptText,
          cohort,
          analysis: { brandMentioned: index === 0 },
        });
        await fixtures.promptScore(owner, auditId, {
          promptIndex: index,
          promptText,
          composite: 50,
          promptId,
          cohort,
        });
      }
      return auditId;
    };
    const gb = frozen({ country_code: 'GB' });
    await run(tenant, '2026-02-23', [[older, 'best crm']], gb);
    const first = await run(tenant, '2026-03-02', [
      [older, 'best crm'],
      [newer, 'cheap crm'],
      [brandQuestion, 'is acme crm any good', 'brand_diagnostic'],
    ]);
    await run(tenant, '2026-03-09', [[newer, 'cheap crm']], gb);
    const third = await run(tenant, '2026-03-16', [
      [newer, 'cheap crm'],
      [older, 'best crm'],
    ]);
    const cited = (domain: string, path = '') => ({ url: `https://${domain}/${path}`, domain });
    await fixtures.execution(tenant, {
      auditId: third,
      promptIndex: 1,
      promptText: 'best crm',
      repetition: 1,
      analysis: {
        citations: [cited('g2.com', 'a'), cited('g2.com', 'b'), cited('capterra.com')],
        competitorMentions: ['Rival'],
      },
    });
    await fixtures.execution(tenant, {
      auditId: third,
      promptIndex: 1,
      promptText: 'best crm',
      repetition: 2,
      analysis: {
        citations: [{ ...cited('acme.com'), isOwned: true }, cited('g2.com')],
        brandMentions: ['Acme'],
      },
    });
    const foreignSet = await promptSet(db, outsider.projectId);
    const foreign = await run(outsider, '2026-03-23', [
      [await trackedPrompt(db, foreignSet, 'best crm'), 'best crm'],
    ]);
    await fixtures.execution(outsider, {
      auditId: foreign,
      promptIndex: 0,
      promptText: 'best crm',
      repetition: 1,
      analysis: { citations: [cited('g2.com')], competitorMentions: ['Rival'] },
    });

    const { status, body } = await get(tenant, route(tenant, '/prompts'), { latest: 'prompt' });

    expect(status).toBe(200);
    const byPrompt = new Map(body.map((item) => [item.prompt_id, item]));
    expect(
      [older, newer, brandQuestion].map((id) => {
        const item = byPrompt.get(id)!;
        return [
          item.audit_id,
          item.cohort,
          item.visibility_rate,
          item.visibility_delta,
          item.comparison_status,
        ];
      }),
    ).toEqual([
      [third, 'core', 0, -100, 'comparable'],
      [third, 'core', 1, null, 'changed_context'],
      [first, 'brand_diagnostic', 0, null, 'no_baseline'],
    ]);
    expect(body).toHaveLength(3);
    const olderItem = byPrompt.get(older)!;
    expect(olderItem.sources).toEqual([
      { domain: 'g2.com', citations: 3, owned: false },
      { domain: 'acme.com', citations: 1, owned: true },
      { domain: 'capterra.com', citations: 1, owned: false },
    ]);
    expect(olderItem.named).toHaveLength(2);
    expect(olderItem.named).toEqual(
      expect.arrayContaining([
        { kind: 'brand', name: 'Acme' },
        { kind: 'competitor', name: 'Rival' },
      ]),
    );
    expect([byPrompt.get(newer)!.sources, byPrompt.get(newer)!.named]).toEqual([[], []]);
    const latestRun = await get(tenant, route(tenant, '/prompts'));
    expect(latestRun.body.map((item) => [item.prompt_id, item.audit_id])).toEqual([
      [newer, third],
      [older, third],
    ]);
    const narrowed: Record<string, string>[] = [
      { cohort: 'core' },
      { audit_id: first },
      { engine: 'chatgpt' },
    ];
    for (const query of narrowed) {
      expect(
        (await get(tenant, route(tenant, '/prompts'), { latest: 'prompt', ...query })).status,
      ).toBe(422);
    }
  });
});

describe('GET /visibility/prompts/{prompt_id}/history', () => {
  const history = (tenant: Tenant, promptId: string) =>
    route(tenant, `/prompts/${promptId}/history`);

  async function measuredRun(
    tenant: Tenant,
    promptId: string,
    input: {
      day: string;
      answers: { mentioned: boolean; cited: boolean; engine?: string }[];
      failed?: number;
      configuration?: Json;
    },
  ): Promise<string> {
    const auditId = await fixtures.audit(tenant, {
      completedAt: new Date(`${input.day}T00:00:00Z`),
      configuration: input.configuration ?? frozen(),
    });
    for (const answer of input.answers) {
      await fixtures.execution(tenant, {
        auditId,
        promptIndex: 0,
        promptText: 'best crm',
        engine: answer.engine ?? 'chatgpt',
        analysis: {
          brandMentioned: answer.mentioned,
          ownedCited: answer.cited,
          score: answer.mentioned ? {} : { competitors_mentioned: ['Globex'] },
        },
      });
    }
    for (let index = 0; index < (input.failed ?? 0); index += 1) {
      await fixtures.execution(tenant, {
        auditId,
        promptIndex: 0,
        promptText: 'best crm',
        taskStatus: 'failed',
        analysis: null,
      });
    }
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 0,
      promptText: 'best crm',
      composite: 50,
      promptId,
    });
    return auditId;
  }

  it("reads a brand-question prompt's history in its own cohort", async () => {
    const tenant = await fixtures.tenant();
    const promptId = await trackedPrompt(
      db,
      await promptSet(db, tenant.projectId),
      'is acme any good',
    );
    await db
      .updateTable('prompts')
      .set({ cohort: 'brand_diagnostic' })
      .where('id', '=', promptId)
      .execute();
    const auditId = await fixtures.audit(tenant, {
      completedAt: new Date('2026-03-02T00:00:00Z'),
      configuration: frozen(),
    });
    await fixtures.execution(tenant, {
      auditId,
      promptIndex: 0,
      promptText: 'is acme any good',
      cohort: 'brand_diagnostic',
      analysis: { brandMentioned: true },
    });
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 0,
      promptText: 'is acme any good',
      composite: 50,
      promptId,
      cohort: 'brand_diagnostic',
    });

    const { status, body } = await get(tenant, history(tenant, promptId));

    expect(status).toBe(200);
    expect([
      body.cohort,
      (body.points as Row[]).map((point) => [point.audit_id, point.mention_rate]),
      record(body.latest).audit_id,
    ]).toEqual(['brand_diagnostic', [[auditId, 1]], auditId]);
  });

  it('reads mention and owned citation rates per run, keeping unavailable apart from zero', async () => {
    const tenant = await fixtures.tenant();
    const promptId = await trackedPrompt(db, await promptSet(db, tenant.projectId), 'best crm');
    const first = await measuredRun(tenant, promptId, {
      day: '2026-03-02',
      answers: [
        { mentioned: true, cited: true },
        { mentioned: false, cited: false, engine: 'claude' },
      ],
    });
    const failedOnly = await measuredRun(tenant, promptId, {
      day: '2026-03-09',
      answers: [],
      failed: 1,
    });
    const zero = await measuredRun(tenant, promptId, {
      day: '2026-03-16',
      answers: [{ mentioned: false, cited: true }],
    });
    const moved = await measuredRun(tenant, promptId, {
      day: '2026-03-23',
      answers: [{ mentioned: true, cited: false }],
      configuration: frozen({ country_code: 'GB' }),
    });

    const { status, body } = await get(tenant, history(tenant, promptId));

    expect(status).toBe(200);
    expect(body.prompt).toMatchObject({ id: promptId, text: 'best crm', status: 'active' });
    expect(
      (body.points as Row[]).map((point) => [
        point.audit_id,
        point.mention_rate,
        point.owned_citation_rate,
        point.answer_states,
        point.comparable_with_previous,
      ]),
    ).toEqual([
      [
        first,
        0.5,
        0.5,
        { mentioned_and_cited: 1, mentioned_only: 0, cited_only: 0, neither: 1 },
        null,
      ],
      [failedOnly, null, null, null, true],
      [zero, 0, 1, { mentioned_and_cited: 0, mentioned_only: 0, cited_only: 1, neither: 0 }, true],
      [
        moved,
        1,
        0,
        { mentioned_and_cited: 0, mentioned_only: 1, cited_only: 0, neither: 0 },
        false,
      ],
    ]);
    const zeroAnswers = await db
      .selectFrom('response_analyses')
      .select('id')
      .where('audit_id', '=', zero)
      .execute();
    expect(record((body.points as Row[])[2]).source_analysis_ids).toEqual(
      zeroAnswers.map((row) => row.id),
    );
    expect(record((body.points as Row[])[1]).counts).toMatchObject({
      state: 'no_observations',
      responses: 0,
      failed: 1,
    });
    expect(record(body.latest)).toMatchObject({ audit_id: moved, visibility_rate: 1 });

    const claude = await get(tenant, history(tenant, promptId), { engine: 'claude' });
    expect((claude.body.points as Row[]).map((point) => point.mention_rate)).toEqual([
      0,
      null,
      null,
      null,
    ]);
  });

  it('stays inside the requested market', async () => {
    const tenant = await fixtures.tenant();
    const promptId = await trackedPrompt(db, await promptSet(db, tenant.projectId), 'best crm');
    const marketId = await newMarket(tenant);
    const home = await measuredRun(tenant, promptId, {
      day: '2026-03-02',
      answers: [{ mentioned: true, cited: false }],
    });
    const abroad = await measuredRun(tenant, promptId, {
      day: '2026-03-09',
      answers: [{ mentioned: false, cited: false }],
    });
    await db.updateTable('audits').set({ market_id: marketId }).where('id', '=', abroad).execute();

    const byDefault = await get(tenant, history(tenant, promptId));
    const byMarket = await get(tenant, history(tenant, promptId), { market: marketId });

    expect((byDefault.body.points as Row[]).map((point) => point.audit_id)).toEqual([home]);
    expect((byMarket.body.points as Row[]).map((point) => point.audit_id)).toEqual([abroad]);
    expect(byMarket.body.market_id).toBe(marketId);
  });

  it('marks declared work whose frozen checks measure the prompt, and names its Action', async () => {
    const tenant = await fixtures.tenant();
    const setId = await promptSet(db, tenant.projectId);
    const promptId = await trackedPrompt(db, setId, 'best crm');
    const otherId = await trackedPrompt(db, setId, 'cheap crm');
    await measuredRun(tenant, promptId, {
      day: '2026-03-02',
      answers: [{ mentioned: false, cited: false }],
    });
    const scope = { workspace_id: tenant.workspaceId, project_id: tenant.projectId };
    const snapshot = snapshotRow(scope);
    await db.insertInto('opportunity_snapshots').values(snapshot).execute();
    const promptAction = actionRow(scope, {
      group_key: `prompt:${promptId}`,
      target_kind: 'prompt',
      target_label: 'best crm',
      target_prompt_id: promptId,
    });
    const earned = actionRow(scope, {
      group_key: 'earned:https://reviews.example/crm',
      target_kind: 'earned_page',
      target_label: 'reviews.example/crm',
      status: 'implemented',
    });
    const unrelated = actionRow(scope, {
      group_key: `prompt:${otherId}`,
      target_kind: 'prompt',
      target_label: 'cheap crm',
      target_prompt_id: otherId,
      status: 'implemented',
    });
    await db.insertInto('actions').values([promptAction, earned, unrelated]).execute();
    const declare = (actionId: string, at: string, promptIds: string[]) => ({
      ...scope,
      id: randomUUID(),
      action_id: actionId,
      output_revision_id: null,
      member_opportunity_ids: '[]',
      opportunity_snapshot_id: snapshot.id,
      target_site_url_ids: '[]',
      target_external_url: null,
      declared_implemented_at: new Date(at),
      expected_checks: JSON.stringify(
        promptIds.map((id) => ({ kind: 'visibility_metric', target_prompt_id: id })),
      ),
      actor_user_id: tenant.userId,
      idempotency_key: randomUUID(),
      request_fingerprint: 'fingerprint',
      created_at: new Date(),
    });
    const earnedDeclaration = declare(earned.id, '2026-03-05T12:00:00Z', [otherId, promptId]);
    await db
      .insertInto('opportunity_implementation_events')
      .values([earnedDeclaration, declare(unrelated.id, '2026-03-04T12:00:00Z', [otherId])])
      .execute();

    const { body } = await get(tenant, history(tenant, promptId));

    expect(body.implementations).toEqual([
      {
        implementation_event_id: earnedDeclaration.id,
        action_id: earned.id,
        title: 'reviews.example/crm',
        status: 'done',
        implemented_at: '2026-03-05T12:00:00Z',
      },
    ]);
    expect(record(body.latest).action_id).toBe(promptAction.id);

    await db
      .updateTable('actions')
      .set({ evidence_cleared_at: new Date() })
      .where('id', '=', promptAction.id)
      .execute();
    const cleared = await get(tenant, history(tenant, promptId));
    expect(record(cleared.body.latest).action_id).toBeNull();
  });

  it('reads a comparison prompt in its own cohort unless one is named', async () => {
    const tenant = await fixtures.tenant();
    const promptId = await trackedPrompt(
      db,
      await promptSet(db, tenant.projectId),
      'acme vs globex',
    );
    await db
      .updateTable('prompts')
      .set({ cohort: 'comparison' })
      .where('id', '=', promptId)
      .execute();
    const auditId = await fixtures.audit(tenant, { completedAt: new Date('2026-03-02T00:00:00Z') });
    await fixtures.execution(tenant, {
      auditId,
      promptIndex: 0,
      promptText: 'acme vs globex',
      cohort: 'comparison',
      analysis: { brandMentioned: true },
    });
    await fixtures.promptScore(tenant, auditId, {
      promptIndex: 0,
      promptText: 'acme vs globex',
      composite: 50,
      cohort: 'comparison',
      promptId,
    });

    const own = await get(tenant, history(tenant, promptId));
    const core = await get(tenant, history(tenant, promptId), { cohort: 'core' });

    expect([
      own.body.cohort,
      (own.body.points as Row[]).map((point) => point.mention_rate),
    ]).toEqual(['comparison', [1]]);
    expect([core.body.cohort, core.body.points]).toEqual(['core', []]);
  });

  it("is a 404 for another workspace's prompt", async () => {
    const tenant = await fixtures.tenant();
    const other = await fixtures.tenant();
    const promptId = await trackedPrompt(db, await promptSet(db, other.projectId), 'best crm');

    const { status, body } = await get(tenant, history(tenant, promptId));

    expect([status, record(body.error).message]).toEqual([404, 'Prompt not found']);
  });
});
