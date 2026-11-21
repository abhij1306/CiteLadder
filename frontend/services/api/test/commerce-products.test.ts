import { randomUUID } from 'node:crypto';
import type {
  CommerceProductDetail,
  CommerceProductPage,
} from '@citeladder/contracts/commerce-suite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { importCatalog } from './commerce-support.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { auditTenant } from './audit-fixtures.ts';
import { addCompetitor, recordAnswer, type AnswerEvidence } from './commerce-answer-fixtures.ts';
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
].join('\n');

async function answer(t: Tenant, text: string, evidence?: AnswerEvidence): Promise<string> {
  const { taskId } = await recordAnswer(db, t, text, {
    runtime,
    worker: 'products-worker',
    evidence,
  });
  tasks.push(taskId);
  return taskId;
}

async function quote(task: string, product: string, price: string, currency: string, host: string) {
  await asOwner((owner) =>
    owner
      .updateTable('commerce_recommendation_observations')
      .set({ observed_price: price, observed_currency: currency, merchant_domain: host })
      .where('task_id', '=', task)
      .where('observed_product', '=', product)
      .execute(),
  );
}

async function read(t: Tenant, query = '', workspace = t.workspaceId) {
  const token = await sessionToken({ sub: t.userId, ver: 0 });
  const response = await app.request(
    `/api/v1/projects/${t.projectId}/commerce/products${query ? `?${query}` : ''}`,
    {
      headers: {
        'x-workspace-id': workspace,
        cookie: `${TEST_SESSION_COOKIE}=${token}`,
      },
    },
  );
  return { status: response.status, body: (await response.json()) as CommerceProductPage };
}

const summary = (page: CommerceProductPage) =>
  page.items.map((row) => [
    row.name,
    row.kind,
    row.appearances,
    row.visibility,
    row.win_rate,
    row.position,
  ]);

let t: Tenant;
let foreign: Tenant;
let trailCategory: string;
let first: string, second: string, third: string;

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
  await addCompetitor(db, t, 'Zoom Glide', { state: 'pending', source: 'ai_observed' });
  await addCompetitor(db, t, 'Dropped Dash', { state: 'rejected', source: 'ai_observed' });
  await addCompetitor(db, t, 'Unreviewed Racer', { state: 'pending' });

  first = await answer(
    t,
    '1. Acme Road Runner for daily miles\n2. Rival Pacer for tempo days\n3. Acme Trail Climber for rocky trails',
    {
      citations: [{ url: 'https://reviews.example/best-road', title: 'Best road shoes' }],
      queries: ['best road running shoes'],
    },
  );
  second = await answer(t, '1. Rival Pacer is the best value\n2. Acme Road Runner close behind');
  third = await answer(t, '1. Acme Road Runner for long road runs');
  await answer(t, 'Most runners should get a gait analysis before buying anything new.');
  await answer(foreign, '1. Acme Road Runner for daily miles');
  await db
    .updateTable('audit_tasks')
    .set({ logical_engine: 'gemini' })
    .where('id', '=', second)
    .execute();
  await db
    .updateTable('audit_tasks')
    .set({ completed_at: new Date(Date.now() - 40 * 86_400_000) })
    .where('id', '=', third)
    .execute();
  await quote(first, 'Acme Road Runner', '110', 'USD', 'runnerstore.com');
  await quote(second, 'Acme Road Runner', '130', 'USD', 'runnerstore.com');
  await quote(third, 'Acme Road Runner', '99', 'EUR', 'shoes.example.eu');
  await quote(second, 'Rival Pacer', '95', 'USD', 'pacer.example');
  trailCategory = (
    await db
      .selectFrom('commerce_categories')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('name', '=', 'Trail')
      .executeTakeFirstOrThrow()
  ).id;
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

describe('Products table read', () => {
  it('reads each catalog product’s metrics over every answer in the window', async () => {
    const { status, body } = await read(t, 'window=90');
    expect(status).toBe(200);
    expect(body).toMatchObject({ window_days: 90, executions: 4, total: 2, next_cursor: null });
    expect(summary(body)).toEqual([
      ['Acme Road Runner', 'owned', 3, 0.75, 2 / 3, 4 / 3],
      ['Acme Trail Climber', 'owned', 1, 0.25, 0, 3],
    ]);
    const [road, trail] = body.items;
    expect(road!.mentioned_price).toEqual({
      median: 120,
      currency: 'USD',
      quoted: 2,
      other_currency: 1,
    });
    expect(road!.catalog_price).toEqual({ min: 120, max: 120, currency: 'USD' });
    expect(road!.merchants).toEqual([
      { domain: 'runnerstore.com', count: 2 },
      { domain: 'shoes.example.eu', count: 1 },
    ]);
    expect(trail).toMatchObject({
      category_ids: [trailCategory],
      catalog_price: null,
      mentioned_price: { median: null, currency: '', quoted: 0, other_currency: 0 },
      merchants: [],
    });
  });

  it('adds approved and AI-observed competitors under All products', async () => {
    const { body } = await read(t, 'window=90&source=all');
    expect(summary(body)).toEqual([
      ['Acme Road Runner', 'owned', 3, 0.75, 2 / 3, 4 / 3],
      ['Rival Pacer', 'approved_competitor', 2, 0.5, 0.5, 1.5],
      ['Acme Trail Climber', 'owned', 1, 0.25, 0, 3],
      ['Zoom Glide', 'ai_observed_competitor', 0, 0, null, null],
    ]);
  });

  it('narrows the executions by window, engine and prompt set', async () => {
    const thirty = await read(t, 'window=30');
    expect(thirty.body.executions).toBe(3);
    expect(summary(thirty.body)[0]).toEqual(['Acme Road Runner', 'owned', 2, 2 / 3, 0.5, 1.5]);

    const chatgpt = await read(t, 'window=90&engine=chatgpt');
    expect(chatgpt.body.executions).toBe(3);
    expect(summary(chatgpt.body)[0]).toEqual(['Acme Road Runner', 'owned', 2, 2 / 3, 1, 1]);

    const none = await read(t, `window=90&prompt_set=${randomUUID()}`);
    expect(none.body.executions).toBe(0);
    expect(summary(none.body)).toEqual([
      ['Acme Road Runner', 'owned', 0, null, null, null],
      ['Acme Trail Climber', 'owned', 0, null, null, null],
    ]);
    const own = await read(t, `window=90&prompt_set=${t.setId}`);
    expect(own.body.executions).toBe(4);
  });

  it('filters holders by category and search, and sorts by the chosen metric', async () => {
    const trail = await read(t, `window=90&source=all&category=${trailCategory}`);
    expect(trail.body.items.map((row) => row.name)).toEqual(['Acme Trail Climber']);
    const search = await read(t, 'window=90&source=all&q=PACER');
    expect(search.body.items.map((row) => row.name)).toEqual(['Rival Pacer']);
    const position = await read(t, 'window=90&source=all&sort=position');
    expect(position.body.items.map((row) => row.name)).toEqual([
      'Acme Road Runner',
      'Rival Pacer',
      'Acme Trail Climber',
      'Zoom Glide',
    ]);
    const name = await read(t, 'window=90&source=all&sort=name');
    expect(name.body.items.map((row) => row.name)).toEqual([
      'Acme Road Runner',
      'Acme Trail Climber',
      'Rival Pacer',
      'Zoom Glide',
    ]);
  });

  it('pages by keyset cursor and refuses a cursor from other filters', async () => {
    const names: string[] = [];
    const joined: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page: CommerceProductPage = (
        await read(
          t,
          `window=90&source=all&sort=win_rate&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).body;
      expect(page.total).toBe(4);
      names.push(...page.items.map((row) => row.name));
      joined.push(
        ...page.items.map((row) => [
          row.mentioned_price.median,
          row.mentioned_price.quoted,
          row.merchants.map((m) => m.domain),
          row.category_ids.length,
        ]),
      );
      cursor = page.next_cursor;
    } while (cursor);
    expect(names).toEqual(['Acme Road Runner', 'Rival Pacer', 'Acme Trail Climber', 'Zoom Glide']);
    expect(joined).toEqual([
      [120, 2, ['runnerstore.com', 'shoes.example.eu'], 1],
      [95, 1, ['pacer.example'], 0],
      [null, 0, [], 1],
      [null, 0, [], 0],
    ]);

    const first = await read(t, 'window=90&source=all&sort=win_rate&limit=1');
    const replayed = await read(
      t,
      `window=90&source=catalog&sort=win_rate&limit=1&cursor=${first.body.next_cursor}`,
    );
    expect(replayed.status).toBe(422);
    const elsewhere = await read(
      foreign,
      `window=90&source=all&sort=win_rate&limit=1&cursor=${first.body.next_cursor}`,
    );
    expect(elsewhere.status).toBe(422);
    expect((await read(t, 'window=14')).status).toBe(422);
  });

  it('counts each answer once, through the pass of the latest catalog revision', async () => {
    const later = await auditTenant(db, fixtures);
    const scope = { workspaceId: later.workspaceId, projectId: later.projectId };
    const [header, road, trail] = CATALOG.split('\n');
    await importCatalog(db, scope, [header, road].join('\n'));
    await answer(later, '1. Acme Road Runner for daily miles\n2. Acme Trail Climber for trails');
    await importCatalog(db, scope, [header, road, trail].join('\n'));
    const matching = await db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', later.workspaceId)
      .where('task_kind', '=', 'commerce_answer_matching')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    await new AnalyticsWorker(db, loadWorkerSettings({}), {
      owner: 'products-test',
      taskScope: { workspaceId: later.workspaceId, taskIds: [matching.id] },
    }).runOnce();

    const { body } = await read(later, 'window=90');
    expect(body.executions).toBe(1);
    expect(summary(body)).toEqual([
      ['Acme Road Runner', 'owned', 1, 1, 1, 1],
      ['Acme Trail Climber', 'owned', 1, 1, 0, 2],
    ]);
  });

  it('merges one product’s records across targets into one row and one page', async () => {
    const merged = await auditTenant(db, fixtures);
    const scope = { workspaceId: merged.workspaceId, projectId: merged.projectId };
    await importCatalog(db, scope, CATALOG);
    await addCompetitor(db, merged, 'Rival Pacer');
    const ids = (table: 'commerce_products' | 'commerce_categories', name: string) =>
      db
        .selectFrom(table)
        .select('id')
        .where('workspace_id', '=', merged.workspaceId)
        .where('name', '=', name)
        .executeTakeFirstOrThrow();
    const [road, trail] = [
      (await ids('commerce_products', 'Acme Road Runner')).id,
      (await ids('commerce_categories', 'Trail')).id,
    ];
    const trailRecord = randomUUID();
    await db
      .insertInto('commerce_competitor_candidates')
      .values({
        id: trailRecord,
        workspace_id: merged.workspaceId,
        project_id: merged.projectId,
        target_kind: 'category',
        target_id: trail,
        canonical_url: 'https://rival.example/products/rival-pacer',
        product_name: 'Rival Pacer',
        brand_name: 'Rival',
        evidence: '{}',
        source_kind: 'ai_observed',
        state: 'pending',
        created_at: new Date(),
      })
      .execute();
    const won = await answer(merged, '1. Rival Pacer for tempo days');
    const lost = await answer(merged, '1. Acme Road Runner for daily miles\n2. Rival Pacer');
    const sighting = (task: string, target: { kind: string; id: string }, holder?: string) =>
      asOwner((owner) =>
        owner
          .updateTable('commerce_recommendation_observations')
          .set({
            target_kind: target.kind,
            target_id: target.id,
            ...(holder ? { competitor_candidate_id: holder } : {}),
          })
          .where('task_id', '=', task)
          .where('observed_product', '=', 'Rival Pacer')
          .execute(),
      );
    await sighting(won, { kind: 'product', id: road });
    await sighting(lost, { kind: 'category', id: trail }, trailRecord);

    const { body } = await read(merged, 'window=90&source=all');
    expect(summary(body)).toEqual([
      ['Rival Pacer', 'approved_competitor', 2, 1, 0.5, 1.5],
      ['Acme Road Runner', 'owned', 1, 0.5, 1, 1],
      ['Acme Trail Climber', 'owned', 0, 0, null, null],
    ]);
    const rival = body.items[0]!.holder_id;
    const inTrail = await read(merged, `window=90&source=all&category=${trail}`);
    expect(inTrail.body.items.map((row) => [row.name, row.holder_id])).toEqual([
      ['Rival Pacer', rival],
      ['Acme Trail Climber', expect.any(String)],
    ]);
    const page = await detail(merged, trailRecord);
    expect(page.body.product).toMatchObject({ holder_id: rival, appearances: 2 });
    expect(page.body.seen_in).toEqual([
      { target_kind: 'product', target_id: road, name: 'Acme Road Runner', answers: 1 },
      { target_kind: 'category', target_id: trail, name: 'Trail', answers: 1 },
    ]);
    expect(page.body.answers.map((row) => row.task_id).sort()).toEqual([won, lost].sort());
    expect((await detail(foreign, trailRecord)).status).toBe(404);
  });

  it('reads only the authorized workspace’s answers and holders', async () => {
    const theirs = await read(foreign, 'window=90&source=all');
    expect(theirs.body.executions).toBe(1);
    expect(summary(theirs.body)).toEqual([
      ['Acme Road Runner', 'owned', 1, 1, 1, 1],
      ['Acme Trail Climber', 'owned', 0, 0, null, null],
    ]);
    expect((await read(t, '', foreign.workspaceId)).status).toBe(404);
  });
});

async function detail(t: Tenant, holder: string, query = 'window=90') {
  const token = await sessionToken({ sub: t.userId, ver: 0 });
  const response = await app.request(
    `/api/v1/projects/${t.projectId}/commerce/products/${holder}?${query}`,
    {
      headers: {
        'x-workspace-id': t.workspaceId,
        cookie: `${TEST_SESSION_COOKIE}=${token}`,
      },
    },
  );
  return { status: response.status, body: (await response.json()) as CommerceProductDetail };
}

async function holderId(t: Tenant, name: string) {
  const all = await read(t, 'window=90&source=all');
  return all.body.items.find((row) => row.name === name)!.holder_id;
}

describe('Product detail read', () => {
  it('reads one product’s metrics and the answers behind them', async () => {
    const { status, body } = await detail(t, await holderId(t, 'Acme Road Runner'));
    expect(status).toBe(200);
    expect(body.executions).toBe(4);
    expect(body.product).toMatchObject({
      name: 'Acme Road Runner',
      kind: 'owned',
      appearances: 3,
      visibility: 0.75,
      win_rate: 2 / 3,
      position: 4 / 3,
      catalog_price: { min: 120, max: 120, currency: 'USD' },
      description: '',
      image_url: null,
    });
    expect(
      body.competing.map((row) => [row.name, row.kind, row.shared, row.ahead, row.position]),
    ).toEqual([
      ['Rival Pacer', 'approved_competitor', 2, 1, 1.5],
      ['Acme Trail Climber', 'owned', 1, 0, 3],
    ]);
    expect(body.merchants).toEqual([
      { domain: 'runnerstore.com', count: 2 },
      { domain: 'shoes.example.eu', count: 1 },
    ]);
    expect(body.sources).toEqual([
      {
        url: 'https://reviews.example/best-road',
        title: 'Best road shoes',
        domain: 'reviews.example',
        count: 1,
      },
    ]);
    expect(body.fan_out_queries).toEqual([{ query: 'best road running shoes', count: 1 }]);
    expect(body.prompts).toEqual([
      expect.objectContaining({
        prompt_id: t.promptId,
        executions: 4,
        appearances: 3,
        visibility: 0.75,
        win_rate: 2 / 3,
        position: 4 / 3,
      }),
    ]);
    expect(body.answers.map((row) => [row.task_id, row.engine, row.rank, row.outcome])).toEqual([
      [second, 'gemini', 2, 'lost'],
      [first, 'chatgpt', 1, 'won'],
      [third, 'chatgpt', 1, 'won'],
    ]);
    expect(body.answer_total).toBe(3);
    expect(body.actions).toEqual([]);
  });

  it('reads a competitor’s page and narrows every section to the chosen executions', async () => {
    const rival = await detail(t, await holderId(t, 'Rival Pacer'));
    expect(rival.body.product).toMatchObject({ kind: 'approved_competitor', appearances: 2 });
    expect(rival.body.competing.map((row) => [row.name, row.shared, row.ahead])).toEqual([
      ['Acme Road Runner', 2, 1],
      ['Acme Trail Climber', 1, 0],
    ]);

    const chatgpt = await detail(
      t,
      await holderId(t, 'Acme Road Runner'),
      'window=30&engine=chatgpt',
    );
    expect(chatgpt.body.executions).toBe(2);
    expect(chatgpt.body.answers.map((row) => row.task_id)).toEqual([first]);
    expect(chatgpt.body.competing.map((row) => [row.name, row.shared, row.ahead])).toEqual([
      ['Acme Trail Climber', 1, 0],
      ['Rival Pacer', 1, 0],
    ]);
  });

  it('finds no page for a holder outside the authorized project or the listed holders', async () => {
    const road = await holderId(t, 'Acme Road Runner');
    expect((await detail(foreign, road)).status).toBe(404);
    const rejected = await db
      .selectFrom('commerce_competitor_candidates')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('product_name', '=', 'Dropped Dash')
      .executeTakeFirstOrThrow();
    expect((await detail(t, rejected.id)).status).toBe(404);
    const theirs = await detail(foreign, await holderId(foreign, 'Acme Road Runner'));
    expect(theirs.body.answer_total).toBe(1);
    expect(theirs.body.sources).toEqual([]);
  });

  // Last in the file: it rejects the approved competitor the reads above count.
  it('drops a competitor rejected after its answers from the competing products', async () => {
    const road = await holderId(t, 'Acme Road Runner');
    const rival = await holderId(t, 'Rival Pacer');
    await db
      .updateTable('commerce_competitor_candidates')
      .set({ state: 'rejected' })
      .where('id', '=', rival)
      .execute();
    const { body } = await detail(t, road);
    expect(body.competing.map((row) => [row.name, row.kind])).toEqual([
      ['Acme Trail Climber', 'owned'],
    ]);
    expect((await detail(t, rival)).status).toBe(404);
  });
});
