import { afterAll, describe, expect, it } from 'vitest';

import { route, visibilityReads, type Row } from './visibility-read-support.ts';

const { db, fixtures, get, measuredRun } = visibilityReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

function aggregate(wins: { answers: number; brand: number }): Record<string, unknown> {
  return {
    win_tally: {
      answers: wins.answers,
      first: { 'Acme Corp': wins.brand, Globex: wins.answers - wins.brand },
    },
    total_completed: 4,
    brand_mention_count: 2,
    owned_citation_response_count: 0,
    brand_mention_rate: 0.5,
    owned_citation_rate: 0,
    competitor_mention_rate: { Globex: 0.5 },
    competitor_citation_rate: { Globex: 0 },
    share_of_voice: { mention_counts: { 'Acme Corp': 2, Globex: 2 } },
    coverage: { requested: 4, failed: 0, not_run: 0 },
    per_prompt: [{ composite_score: 50 }],
  };
}

describe('GET /visibility win rate', () => {
  it('serves counts per brand and engine, and no rate when no answer named a tracked business', async () => {
    const tenant = await fixtures.tenant();
    await fixtures.brand(tenant.projectId, 'Acme Corp', true);
    await fixtures.competitor(tenant.projectId, { name: 'Globex', domains: ['globex.example'] });
    const before = await measuredRun(
      tenant,
      '2026-03-01T00:00:00Z',
      aggregate({ answers: 0, brand: 0 }),
    );
    await measuredRun(tenant, '2026-03-08T00:00:00Z', aggregate({ answers: 3, brand: 1 }));

    const { status, body } = await get(tenant, route(tenant));
    expect(status).toBe(200);
    const byName = (rows: unknown) =>
      Object.fromEntries((rows as Row[]).map((row) => [row.name, row]));
    expect(byName(body.rankings)).toMatchObject({
      'Acme Corp': { is_brand: true, win_count: 1, win_answers: 3, win_rate: 1 / 3 },
      Globex: { win_count: 2, win_answers: 3, win_rate: 2 / 3 },
    });
    expect(body.per_engine).toMatchObject([
      { logical_engine: 'chatgpt', win_count: 1, win_answers: 3, win_rate: 1 / 3 },
    ]);

    const none = await get(tenant, route(tenant), { audit_id: before });
    expect(byName(none.body.rankings)['Acme Corp']).toMatchObject({
      win_count: 0,
      win_answers: 0,
      win_rate: null,
    });
  });

  it('pools a period as summed counts, never a mean of rates', async () => {
    const tenant = await fixtures.tenant();
    await measuredRun(tenant, '2026-04-02T00:00:00Z', aggregate({ answers: 3, brand: 1 }));
    await measuredRun(tenant, '2026-04-05T00:00:00Z', aggregate({ answers: 4, brand: 4 }));

    const { status, body } = await get(tenant, route(tenant), {
      selection_mode: 'range',
      from: '2026-04-01T00:00:00Z',
      to: '2026-04-08T00:00:00Z',
    });
    expect(status).toBe(200);
    expect((body.rankings as Row[]).find((row) => row.is_brand)).toMatchObject({
      win_count: 5,
      win_answers: 7,
      win_rate: 5 / 7,
    });
  });
});
