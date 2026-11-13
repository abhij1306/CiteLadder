/**
 * The Shopping overview read against real PostgreSQL: brand and product
 * rankings over the latest match pass of each answer in the window, the
 * catalog's most and least visible products, merchants, fan-out queries of
 * answers that held a product, the category filter with its latest shelf
 * snapshot, and workspace isolation. Answers go through the real audit,
 * matching and persistence path; merchants, fan-out queries and the snapshot
 * are set on stored rows afterwards, since text answers carry none of them.
 */
import { randomUUID } from 'node:crypto';
import type { CommerceShoppingOverview } from '@citeladder/contracts/commerce-suite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { importCatalog } from './commerce-support.ts';
import { auditTenant } from './audit-fixtures.ts';
import { addCompetitor, recordAnswer } from './commerce-answer-fixtures.ts';
import { TEST_SESSION_COOKIE, asOwner, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = { ...auditRuntime({}), activeLimit: 10 },
  config = testConfig(),
  app = createApp(config, db);
const tasks: string[] = [];

type Tenant = Awaited<ReturnType<typeof auditTenant>>;
const CATALOG = [
  'link,title,brand,price,currency,category',
  'https://shop.example/products/road,Acme Road Runner,Acme,120,USD,Road',
  'https://shop.example/products/trail,Acme Trail Climber,Acme,,,Trail',
  'https://shop.example/products/sock,Acme Merino Sock,Acme,15,USD,Road',
].join('\n');

/** One brand-run answer of `text`; its task id. */
async function answer(t: Tenant, text: string): Promise<string> {
  const { taskId } = await recordAnswer(db, t, text, { runtime, worker: 'overview-worker' });
  tasks.push(taskId);
  return taskId;
}

const merchant = (task: string, product: string, host: string) =>
  asOwner((owner) =>
    owner
      .updateTable('commerce_recommendation_observations')
      .set({ merchant_domain: host })
      .where('task_id', '=', task)
      .where('observed_product', '=', product)
      .execute(),
  );

/** The fan-out the answer's analysis settled: its queries, or a search that exposed none. */
const fanout = (task: string, queries: string[]) =>
  db
    .updateTable('response_analyses')
    .set({
      fanout_queries: queries,
      fanout_state: queries.length ? 'queries_available' : 'count_only',
    })
    .where('task_id', '=', task)
    .execute();

async function read(t: Tenant, query = '', workspace = t.workspaceId) {
  const token = await sessionToken({ sub: t.userId, ver: 0 });
  const response = await app.request(
    `/api/v1/projects/${t.projectId}/commerce/overview${query ? `?${query}` : ''}`,
    { headers: { 'x-workspace-id': workspace, cookie: `${TEST_SESSION_COOKIE}=${token}` } },
  );
  return { status: response.status, body: (await response.json()) as CommerceShoppingOverview };
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name);

let t: Tenant;
let foreign: Tenant;
let roadCategory: string;

async function categoryId(tenant: Tenant, name: string) {
  return (
    await db
      .selectFrom('commerce_categories')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .where('name', '=', name)
      .executeTakeFirstOrThrow()
  ).id;
}

beforeAll(async () => {
  t = await auditTenant(db, fixtures);
  foreign = await auditTenant(db, fixtures);
  for (const tenant of [t, foreign])
    await importCatalog(
      db,
      { workspaceId: tenant.workspaceId, projectId: tenant.projectId },
      CATALOG,
    );
  await addCompetitor(db, t, 'Rival Pacer');

  const first = await answer(
    t,
    '1. Acme Road Runner for daily miles\n2. Rival Pacer for tempo days\n3. Acme Trail Climber for rocky trails',
  );
  const second = await answer(
    t,
    '1. Rival Pacer is the best value\n2. Acme Road Runner close behind',
  );
  // An answer that holds no product: its fan-out queries are not counted.
  const third = await answer(t, 'Most runners should get a gait analysis first.');
  await answer(foreign, '1. Acme Road Runner for daily miles');
  await merchant(first, 'Acme Road Runner', 'runnerstore.com');
  await merchant(second, 'Acme Road Runner', 'runnerstore.com');
  await merchant(second, 'Rival Pacer', 'rival.example');
  await fanout(first, ['best road running shoes', 'best road running shoes', 'acme reviews']);
  // It searched, but its provider exposed no query text.
  await fanout(second, []);
  await fanout(third, ['gait analysis near me']);
  roadCategory = await categoryId(t, 'Road');
});

afterAll(async () => {
  if (tasks.length) {
    await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
    await asOwner((owner) =>
      owner.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute(),
    );
  }
  await fixtures.cleanup();
  await db.destroy();
});

describe('Shopping overview read', () => {
  it('ranks brands with Share of Shelf, and every product holder', async () => {
    const { status, body } = await read(t);
    expect(status).toBe(200);
    expect(body).toMatchObject({ window_days: 30, category: null, executions: 3, slots: 5 });
    // Acme's best slot per answer: rank 1 then rank 2; three of five slots.
    expect(body.brands).toEqual([
      {
        brand: 'Acme',
        owned: true,
        visibility: 2 / 3,
        appearances: 2,
        ordered_appearances: 2,
        win_rate: 0.5,
        position: 1.5,
        slots: 3,
        share_of_shelf: 3 / 5,
      },
      {
        brand: 'Rival',
        owned: false,
        visibility: 2 / 3,
        appearances: 2,
        ordered_appearances: 2,
        win_rate: 0.5,
        position: 1.5,
        slots: 2,
        share_of_shelf: 2 / 5,
      },
    ]);
    expect(
      body.products.map((row) => [row.name, row.kind, row.appearances, row.win_rate, row.position]),
    ).toEqual([
      ['Acme Road Runner', 'owned', 2, 0.5, 1.5],
      ['Rival Pacer', 'approved_competitor', 2, 0.5, 1.5],
      ['Acme Trail Climber', 'owned', 1, 0, 3],
      // Never recommended: a real zero, with no rank to average.
      ['Acme Merino Sock', 'owned', 0, null, null],
    ]);
  });

  it('lists the catalog’s most and least visible products without overlap', async () => {
    const { body } = await read(t);
    expect(names(body.most_visible)).toEqual([
      'Acme Road Runner',
      'Acme Trail Climber',
      'Acme Merino Sock',
    ]);
    // Every catalog product is already among the most visible.
    expect(body.least_visible).toEqual([]);
  });

  it('reads merchants and the fan-out of answers that held a product', async () => {
    const { body } = await read(t);
    expect(body.merchants).toEqual([
      { domain: 'runnerstore.com', answers: 2, products: 1 },
      { domain: 'rival.example', answers: 1, products: 1 },
    ]);
    // The second answer searched without exposing its queries: neither with
    // queries nor without a search.
    expect(body.fanout).toEqual({
      answers: 2,
      answers_with_queries: 1,
      answers_without_search: 0,
      queries: [
        { query: 'acme reviews', answers: 1 },
        { query: 'best road running shoes', answers: 1 },
      ],
    });
  });

  it('narrows to a category and reads its latest shelf snapshot', async () => {
    const before = await read(t, `category=${roadCategory}`);
    expect(names(before.body.products)).toEqual([
      'Acme Road Runner',
      'Rival Pacer',
      'Acme Merino Sock',
    ]);
    // Measured by no Commerce audit yet: unavailable, not zero.
    expect(before.body.category_shelf).toBeNull();
    expect(before.body.slots).toBe(4);

    const [audit] = await db
      .selectFrom('audits')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .limit(1)
      .execute();
    const measured = new Date('2026-11-01T00:00:00.000Z');
    await db
      .insertInto('commerce_shelf_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        audit_id: audit!.id,
        target_kind: 'category',
        target_id: roadCategory,
        formula_version: 'test',
        product_visibility: 0,
        share_of_shelf: null,
        average_shelf_position: null,
        first_position_win_rate: null,
        successful_execution_count: 0,
        recognized_slot_count: 0,
        ranked_execution_count: 0,
        source_observation_ids: '[]',
        context_snapshot: '{}',
        created_at: measured,
      })
      .execute();
    const after = await read(t, `category=${roadCategory}`);
    expect(after.body.category_shelf).toEqual({
      // Stored as 0 with no successful execution: unavailable.
      product_visibility: null,
      share_of_shelf: null,
      average_shelf_position: null,
      first_position_win_rate: null,
      successful_execution_count: 0,
      recognized_slot_count: 0,
      ranked_execution_count: 0,
      measured_at: measured.toISOString(),
    });
  });

  it('keeps visibility unavailable when no answer is in the window', async () => {
    const empty = await auditTenant(db, fixtures);
    await importCatalog(
      db,
      { workspaceId: empty.workspaceId, projectId: empty.projectId },
      CATALOG,
    );
    const { body } = await read(empty, 'window=7');
    expect(body).toMatchObject({ window_days: 7, executions: 0, slots: 0 });
    expect(body.brands).toEqual([
      {
        brand: 'Acme',
        owned: true,
        visibility: null,
        appearances: 0,
        ordered_appearances: 0,
        win_rate: null,
        position: null,
        slots: 0,
        share_of_shelf: null,
      },
    ]);
    expect((await read(empty, 'window=14')).status).toBe(422);
  });

  it('reads only the authorized workspace’s answers, holders and categories', async () => {
    const theirs = await read(foreign);
    expect(theirs.body.executions).toBe(1);
    expect(theirs.body.products.map((row) => [row.name, row.appearances])).toEqual([
      ['Acme Road Runner', 1],
      ['Acme Merino Sock', 0],
      ['Acme Trail Climber', 0],
    ]);
    expect(theirs.body.merchants).toEqual([]);
    // Their answer ran no search.
    expect(theirs.body.fanout).toEqual({
      answers: 1,
      answers_with_queries: 0,
      answers_without_search: 1,
      queries: [],
    });
    // Another project's category is not found here.
    expect((await read(foreign, `category=${roadCategory}`)).status).toBe(404);
    expect((await read(t, '', foreign.workspaceId)).status).toBe(404);
  });
});
