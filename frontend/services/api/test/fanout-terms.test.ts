import { afterAll, describe, expect, it } from 'vitest';

import { countQueries, persistFanoutTerms } from '../src/analysis/fanout-terms.ts';
import { scoringConfig } from '../src/analysis/scoring.ts';
import type { Tenant } from './visibility-fixtures.ts';
import { frozen, route, visibilityReads } from './visibility-read-support.ts';

const { db, fixtures, get } = visibilityReads();
const CONFIGURATION = {
  brand_name: 'Acme Cloud',
  brand_aliases: ['Acme'],
  competitors: [{ name: 'Northwind', aliases: ['NW'], domains: [] }],
};

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('fanout query counts', () => {
  it('counts each exact query and gives it every tracked brand it names', () => {
    const { totalSearches, queries } = countQueries(
      [
        'Harbor & Pine coffee',
        'harbor and pine coffee',
        'Harbor & Pine coffee',
        'acmecloud pricing',
        'pine furniture',
        'Ridgeline Roasting Co. vs NW',
        '',
      ],
      scoringConfig({
        ...CONFIGURATION,
        competitors: [
          ...CONFIGURATION.competitors,
          { name: 'Harbor & Pine', aliases: [], domains: [] },
          { name: 'Ridgeline Roasting Co.', aliases: [], domains: [] },
        ],
      }),
    );
    const harbor = [{ kind: 'competitor', name: 'Harbor & Pine' }];
    expect(totalSearches).toBe(6);
    expect(queries).toEqual([
      { query: 'Harbor & Pine coffee', searches: 2, brands: harbor },
      {
        query: 'Ridgeline Roasting Co. vs NW',
        searches: 1,
        brands: [
          { kind: 'competitor', name: 'Northwind' },
          { kind: 'competitor', name: 'Ridgeline Roasting Co.' },
        ],
      },
      { query: 'acmecloud pricing', searches: 1, brands: [{ kind: 'brand', name: 'Acme Cloud' }] },
      { query: 'harbor and pine coffee', searches: 1, brands: harbor },
      { query: 'pine furniture', searches: 1, brands: [] },
    ]);
  });
});

async function finalizedRun(
  tenant: Tenant,
  completedAt: string,
  answers: { engine: string; queries: string[] }[],
  frozenOverrides: Record<string, unknown> = {},
) {
  const auditId = await fixtures.audit(tenant, {
    completedAt: new Date(completedAt),
    configuration: { ...frozen(frozenOverrides), ...CONFIGURATION },
  });
  for (const answer of answers)
    await fixtures.execution(tenant, {
      auditId,
      engine: answer.engine,
      artifactEvents: answer.queries.map((query, sequence) => ({ sequence, query })),
      analysis: { searchUsed: true, searchQueryCount: answer.queries.length },
    });
  const audit = await db
    .selectFrom('audits')
    .selectAll()
    .where('id', '=', auditId)
    .executeTakeFirstOrThrow();
  const analyses = await db
    .selectFrom('response_analyses')
    .selectAll()
    .where('audit_id', '=', auditId)
    .execute();
  await db
    .transaction()
    .execute((trx) =>
      persistFanoutTerms(trx, audit, analyses, scoringConfig(audit.configuration), new Date()),
    );
  return auditId;
}

const mark = (kind: string, name: string) => ({ kind, name, logo_url: null, website: null });
const acme = [mark('brand', 'Acme Cloud')];
type Item = { query: string; event_count: number; share: number; change: number | null };
const rows = (body: Record<string, unknown>) =>
  (body.items as (Item & { brands: unknown })[]).map(
    ({ query, event_count, share, change, brands }) => ({
      query,
      event_count,
      share,
      change,
      brands,
    }),
  );

describe('GET /visibility/fanout share, change and brands', () => {
  it('compares one run with its previous comparable run under the same filters', async () => {
    const tenant = await fixtures.tenant();
    const outsider = await fixtures.tenant();
    const february = await finalizedRun(tenant, '2026-02-01T00:00:00Z', [
      { engine: 'chatgpt', queries: ['acme pricing', 'free trial'] },
      { engine: 'gemini', queries: ['acme pricing'] },
    ]);
    const march = await finalizedRun(tenant, '2026-03-01T00:00:00Z', [
      { engine: 'chatgpt', queries: ['Acme pricing for agencies', 'NW pricing', 'acme pricing'] },
      { engine: 'gemini', queries: ['acmecloud review', 'acme pricing'] },
      { engine: 'claude', queries: [] },
    ]);
    const read = async (params: Record<string, string | string[]>) =>
      (await get(tenant, route(tenant, '/fanout'), { audit_id: march, ...params })).body;

    const top = await read({});
    expect(top.compared).toBe(true);
    expect(rows(top)).toEqual([
      { query: 'acme pricing', event_count: 2, share: 0.4, change: -0.266667, brands: acme },
      { query: 'Acme pricing for agencies', event_count: 1, share: 0.2, change: 0.2, brands: acme },
      {
        query: 'NW pricing',
        event_count: 1,
        share: 0.2,
        change: 0.2,
        brands: [mark('competitor', 'Northwind')],
      },
      { query: 'acmecloud review', event_count: 1, share: 0.2, change: 0.2, brands: acme },
    ]);
    expect(rows(await read({ order: 'rising' })).map((row) => row.query)).toEqual([
      'Acme pricing for agencies',
      'NW pricing',
      'acmecloud review',
    ]);
    expect(rows(await read({ order: 'falling' }))).toEqual([
      { query: 'free trial', event_count: 0, share: 0, change: -0.333333, brands: [] },
      { query: 'acme pricing', event_count: 2, share: 0.4, change: -0.266667, brands: acme },
    ]);
    expect(rows(await read({ engine: 'gemini' }))).toEqual([
      { query: 'acme pricing', event_count: 1, share: 0.5, change: -0.5, brands: acme },
      { query: 'acmecloud review', event_count: 1, share: 0.5, change: 0.5, brands: acme },
    ]);
    const pooled = (await get(tenant, route(tenant, '/fanout'), { audit_ids: [february, march] }))
      .body;
    expect(pooled.compared).toBe(false);
    expect(rows(pooled)[0]).toEqual({
      query: 'acme pricing',
      event_count: 4,
      share: 0.5,
      change: null,
      brands: acme,
    });
    expect((await get(outsider, route(tenant, '/fanout'), { audit_id: march })).status).toBe(404);
  });

  it('fails a read of a corrupt stored query row instead of reading it as not counted', async () => {
    const tenant = await fixtures.tenant();
    const run = await finalizedRun(tenant, '2026-02-01T00:00:00Z', [
      { engine: 'chatgpt', queries: ['acme pricing'] },
    ]);
    const read = async () =>
      (await get(tenant, route(tenant, '/fanout'), { audit_id: run })).status;
    expect(await read()).toBe(200);
    await db
      .updateTable('audit_fanout_terms')
      .set({ terms: JSON.stringify([{ term: 'acme', searches: 1 }]) })
      .where('audit_id', '=', run)
      .execute();
    expect(await read()).toBe(500);
  });

  it('compares only with a comparable whole-set run that reported search text', async () => {
    const tenant = await fixtures.tenant();
    const compared = async (auditId: string) =>
      (await get(tenant, route(tenant, '/fanout'), { audit_id: auditId })).body.compared;
    await finalizedRun(tenant, '2026-02-01T00:00:00Z', [
      { engine: 'chatgpt', queries: ['acme pricing'] },
    ]);
    const silent = await finalizedRun(tenant, '2026-03-01T00:00:00Z', [
      { engine: 'claude', queries: [] },
    ]);
    const quiet = (await get(tenant, route(tenant, '/fanout'), { audit_id: silent })).body;
    expect(quiet).toMatchObject({ compared: false, items: [] });
    const selected = await finalizedRun(
      tenant,
      '2026-03-15T00:00:00Z',
      [{ engine: 'chatgpt', queries: ['acme trial'] }],
      { panel_hash: 'panel-subset', prompt_selection: 'selected' },
    );
    expect(await compared(selected)).toBe(false);
    const next = await finalizedRun(tenant, '2026-04-01T00:00:00Z', [
      { engine: 'chatgpt', queries: ['acme pricing', 'acme trial'] },
    ]);
    const read = async (order: string) =>
      rows((await get(tenant, route(tenant, '/fanout'), { audit_id: next, order })).body).map(
        ({ query, change }) => ({ query, change }),
      );
    expect(await read('rising')).toEqual([{ query: 'acme trial', change: 0.5 }]);
    expect(await read('falling')).toEqual([{ query: 'acme pricing', change: -0.5 }]);
    const changed = await finalizedRun(
      tenant,
      '2026-05-01T00:00:00Z',
      [{ engine: 'chatgpt', queries: ['acme pricing'] }],
      { panel_hash: 'panel-2' },
    );
    expect(await compared(changed)).toBe(false);
  });
});
