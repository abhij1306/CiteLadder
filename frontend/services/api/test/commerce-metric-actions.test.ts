/**
 * Commerce Actions from the per-product metrics against real PostgreSQL: the
 * Opportunity refresh raises `product_not_mentioned`, `price_mismatch`,
 * `losing_position` and `merchant_absent` from the Products read over every
 * matched answer in the window, never for a product with too little data and
 * never from another workspace's answers; a declared Action's check then reads
 * the same metric over the answers after go-live. Answers go through the real
 * audit, matching and persistence path; only quoted prices and merchants are
 * set on the stored observations afterwards.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditRuntime } from '../src/audits/config.ts';
import { importCatalog } from './commerce-support.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';
import { getAction } from '../src/opportunities/actions.ts';
import { declareAction } from '../src/opportunities/declarations.ts';
import { enqueueImplementationVerification } from '../src/opportunities/enqueue.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { workspaceTaskIds } from './analytics-drain.ts';
import { auditTenant } from './audit-fixtures.ts';
import { addCompetitor, recordAnswer } from './commerce-answer-fixtures.ts';
import { asOwner, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = { ...auditRuntime({}), activeLimit: 20 };
const tasks: string[] = [];
const DAY = 86_400_000;
const METRIC_RULES = [
  'losing_position',
  'merchant_absent',
  'price_mismatch',
  'product_not_mentioned',
];

type Tenant = Awaited<ReturnType<typeof auditTenant>>;
// The fixture project's website is acme.example, so shop.acme.example is the business's own store.
const CATALOG = [
  'link,title,brand,price,currency,category',
  'https://shop.example/products/road,Acme Road Runner,Acme,120,USD,Road',
  'https://shop.example/products/trail,Acme Trail Climber,Acme,80,USD,Trail',
  'https://shop.example/products/gem,Acme Hidden Gem,Acme,50,USD,Road',
].join('\n');

/** One brand-run answer of `text`; its task id. */
async function answer(t: Tenant, text: string): Promise<string> {
  const { taskId } = await recordAnswer(db, t, text, { runtime, worker: 'metric-actions' });
  tasks.push(taskId);
  return taskId;
}

/** The quote and merchant on one task's observation of a product. */
async function quote(
  task: string,
  product: string,
  price: string | null,
  host: string,
  currency = 'USD',
) {
  await asOwner((owner) =>
    owner
      .updateTable('commerce_recommendation_observations')
      .set({
        observed_price: price,
        observed_currency: price ? currency : '',
        merchant_domain: host,
      })
      .where('task_id', '=', task)
      .where('observed_product', '=', product)
      .execute(),
  );
}

async function productId(t: Tenant, name: string) {
  const row = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('workspace_id', '=', t.workspaceId)
    .where('name', '=', name)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The tenant's live per-product metric findings, as (rule, target). */
async function findings(t: Tenant) {
  await recomputeOpportunities(db, { workspaceId: t.workspaceId, projectId: t.projectId });
  const rows = await db
    .selectFrom('opportunities')
    .select(['rule_id', 'target_key', 'evidence', 'source_metric_ids', 'action_id'])
    .where('workspace_id', '=', t.workspaceId)
    .where('superseded_at', 'is', null)
    .where('rule_id', 'in', METRIC_RULES)
    .orderBy('rule_id')
    .orderBy('target_key')
    .execute();
  return rows;
}

/** The answer's run settles when its answer did, and the verification worker reads it. */
async function settle(t: Tenant, task: string) {
  const { audit_id: auditId } = await db
    .selectFrom('audit_tasks')
    .select('audit_id')
    .where('id', '=', task)
    .executeTakeFirstOrThrow();
  await sql`UPDATE audits SET completed_at = (SELECT completed_at FROM audit_tasks WHERE id = ${task})
            WHERE id = ${auditId}`.execute(db);
  await enqueueImplementationVerification(db, {
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    triggerKind: 'audit',
    triggerId: auditId,
    maxAttempts: 3,
  });
  // Only verification runs: the catalog's backfill would re-match the quoted answers.
  for (;;) {
    const taskIds = await workspaceTaskIds(db, t.workspaceId, 'opportunity_verification');
    const worker = new AnalyticsWorker(db, loadWorkerSettings({}), {
      owner: `metric-actions-${randomUUID()}`,
      taskScope: { workspaceId: t.workspaceId, taskIds },
    });
    if ((await worker.runOnce()) === 0) break;
  }
}

let t: Tenant;
let foreign: Tenant;
let road: string, trail: string, gem: string;

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
    '1. Rival Pacer for tempo days\n2. Acme Road Runner for daily miles\n3. Acme Trail Climber for rocky trails',
  );
  const second = await answer(
    t,
    '1. Rival Pacer is the best value\n2. Acme Road Runner close behind',
  );
  const third = await answer(
    t,
    '1. Rival Pacer for racing\n2. Acme Road Runner for comfort\n3. Acme Trail Climber for mud',
  );
  const fourth = await answer(t, '1. Acme Trail Climber for trails\n2. Acme Road Runner for roads');
  const fifth = await answer(t, 'Most runners should get a gait analysis before buying anything.');
  // Another workspace's answers name the product this one never sees.
  await answer(foreign, '1. Acme Hidden Gem for everything\n2. Acme Road Runner for roads');
  await answer(foreign, '1. Acme Hidden Gem again\n2. Acme Road Runner again');
  await quote(first, 'Acme Road Runner', '150', 'runnerstore.com');
  await quote(second, 'Acme Road Runner', '150', 'runnerstore.com');
  // One quote is too few to judge Trail Climber's price.
  await quote(first, 'Acme Trail Climber', '60', 'shop.acme.example');
  await quote(third, 'Acme Trail Climber', null, 'outdoors.example');
  // Two days old, so a go-live a day ago comes after them.
  await db
    .updateTable('audit_tasks')
    .set({ completed_at: new Date(Date.now() - 2 * DAY) })
    .where('id', 'in', [first, second, third, fourth, fifth])
    .execute();
  [road, trail, gem] = [
    await productId(t, 'Acme Road Runner'),
    await productId(t, 'Acme Trail Climber'),
    await productId(t, 'Acme Hidden Gem'),
  ];
});

afterAll(async () => {
  for (const tenant of [t, foreign]) {
    await db.deleteFrom('opportunities').where('workspace_id', '=', tenant.workspaceId).execute();
    await db.deleteFrom('actions').where('workspace_id', '=', tenant.workspaceId).execute();
  }
  if (tasks.length) {
    await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
    await asOwner((owner) =>
      owner.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute(),
    );
  }
  await fixtures.cleanup();
  await db.destroy();
});

describe('Commerce Actions from the per-product metrics', () => {
  it('raises each rule from the window of this workspace’s matched answers', async () => {
    const rows = await findings(t);
    expect(rows.map((row) => [row.rule_id, row.target_key])).toEqual([
      // Listed in four ordered answers, first in none.
      ['losing_position', `product:${road}`],
      // Both merchants named for it are third parties.
      ['merchant_absent', `product:${road}`],
      // Quoted at a median of 150 against a catalog price of 120.
      ['price_mismatch', `product:${road}`],
      // In none of the five answers; the other workspace's answers name it twice.
      ['product_not_mentioned', `product:${gem}`],
    ]);
    const price = rows.find((row) => row.rule_id === 'price_mismatch')!;
    expect(price.evidence).toMatchObject({
      product_id: road,
      product_name: 'Acme Road Runner',
      window_days: 30,
      executions: 5,
      metric: 'price_gap_share',
      value: 0.25,
      samples: 2,
      threshold: 0.1,
      mentioned_price: { median: 150, currency: 'USD', quoted: 2 },
      catalog_price: { amount: 120, currency: 'USD' },
    });
    // Provenance: Road Runner's observations in the answers measured.
    const observed = await db
      .selectFrom('commerce_recommendation_observations')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('product_id', '=', road)
      .execute();
    expect(observed).toHaveLength(4);
    expect([...(price.source_metric_ids as string[])].sort()).toEqual(
      observed.map((row) => row.id).sort(),
    );
    // Trail Climber wins one of three ordered answers, has one quote and one answer to its own store.
    expect(rows.some((row) => row.target_key === `product:${trail}`)).toBe(false);
  });

  it('raises nothing for products with too little data', async () => {
    // Two answers: below every rule's minimum, though Trail Climber is never named.
    const rows = await findings(foreign);
    expect(rows.map((row) => [row.rule_id, row.target_key])).toEqual([]);
    // The same catalog in a workspace with five answers does raise findings.
    expect((await findings(t)).map((row) => row.rule_id)).toContain('product_not_mentioned');
  });

  it('verifies a declared Action against the same metrics in the answers after go-live', async () => {
    // Road Runner's three findings are one product Action.
    const [absent] = (await findings(t)).filter((row) => row.rule_id === 'merchant_absent');
    const actionId = absent!.action_id!;
    await declareAction(
      db,
      { workspaceId: t.workspaceId, projectId: null },
      actionId,
      t.userId,
      randomUUID(),
      {
        output_revision_id: null,
        declared_implemented_at: new Date(Date.now() - DAY).toISOString(),
      },
    );
    const declared = await db
      .selectFrom('opportunity_implementation_events')
      .select('expected_checks')
      .where('action_id', '=', actionId)
      .executeTakeFirstOrThrow();
    const frozen = declared.expected_checks as { metric: string }[];
    const product = { kind: 'product_metric', product_id: road, product_name: 'Acme Road Runner' };
    // Each baseline is the reading over the window that ended at go-live.
    expect(frozen.toSorted((a, b) => a.metric.localeCompare(b.metric))).toEqual([
      {
        ...product,
        metric: 'owned_merchant_answers',
        comparison: 'at_least',
        target: 1,
        min_samples: 2,
        window_days: 30,
        baseline_value: 0,
      },
      {
        ...product,
        metric: 'price_gap_share',
        comparison: 'at_most',
        target: 0.1,
        min_samples: 2,
        window_days: 30,
        baseline_value: 0.25,
      },
      {
        ...product,
        metric: 'win_rate',
        comparison: 'at_least',
        target: 0.2,
        min_samples: 3,
        window_days: 30,
        baseline_value: 0,
      },
    ]);
    /** Each check's state and reason, by the metric it reads. */
    const checks = async () => {
      const detail = await getAction(db, t.workspaceId, actionId);
      return Object.fromEntries(
        (detail.declaration?.checks ?? []).map((item) => [
          frozen[item.index]!.metric,
          [item.state, item.reason, item.subject],
        ]),
      );
    };
    const road_ = 'Acme Road Runner';
    expect(await checks()).toEqual({
      owned_merchant_answers: ['waiting', null, road_],
      price_gap_share: ['waiting', null, road_],
      win_rate: ['waiting', null, road_],
    });

    // One answer after go-live is too few to judge any of them; its only
    // quote is in euros, which the price check does not convert.
    const later = await answer(t, '1. Acme Road Runner for daily miles');
    await quote(later, 'Acme Road Runner', '120', 'runnerstore.com', 'EUR');
    await settle(t, later);
    expect(await checks()).toEqual({
      owned_merchant_answers: ['waiting', 'too_few_samples', road_],
      price_gap_share: ['waiting', 'quotes_in_other_currencies', road_],
      win_rate: ['waiting', 'too_few_samples', road_],
    });

    // A second answer quotes the catalog price and sends shoppers to the
    // business's own store; one dollar quote and three ordered answers are
    // still needed.
    const own = await answer(t, '1. Acme Road Runner for long runs');
    await quote(own, 'Acme Road Runner', '120', 'shop.acme.example');
    await settle(t, own);
    expect(await checks()).toEqual({
      owned_merchant_answers: ['met', null, road_],
      price_gap_share: ['waiting', 'too_few_samples', road_],
      win_rate: ['waiting', 'too_few_samples', road_],
    });

    // A third answer lists it first again at the catalog price: three wins in
    // three ordered answers, and two dollar quotes at the catalog price.
    const third = await answer(t, '1. Acme Road Runner for tempo runs\n2. Rival Pacer');
    await quote(third, 'Acme Road Runner', '120', 'runnerstore.com');
    await settle(t, third);
    expect(await checks()).toEqual({
      owned_merchant_answers: ['met', null, road_],
      price_gap_share: ['met', null, road_],
      win_rate: ['met', null, road_],
    });
    const detail = await getAction(db, t.workspaceId, actionId);
    expect(detail.declaration?.state).toBe('verified');
  });
});
