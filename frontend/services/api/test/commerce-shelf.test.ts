import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { asOwner, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createAudits } from '../src/audits/creation.ts';
import { AuditQueue, type AuditTask } from '../src/queue/audit-queue.ts';
import { persistExecutionSuccess, type ExecutionResult } from '../src/audits/result-persistence.ts';
import { categoryByName, newProduct, addMembership } from '../src/commerce/catalog-store.ts';
import { prepareShelfExecution } from '../src/commerce/shelf.ts';
import { finalizeCommerceShelf, shelfMetrics } from '../src/commerce/shelf-metrics.ts';
import { auditProjections } from '../src/audits/projections.ts';
import {
  observedPrice,
  matchRecommendation,
  prepareRecommendations,
  resolvedCompetitorUrl,
  type FrozenShelfTarget,
} from '../src/commerce/shelf-parsing.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({});
const tasks: string[] = [],
  workspaces: string[] = [];
afterEach(async () => {
  if (tasks.length) {
    await db.deleteFrom('execution_cost_projections').where('task_id', 'in', tasks).execute();
    await asOwner((owner) =>
      owner.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute(),
    );
  }
  if (workspaces.length)
    await asOwner((owner) =>
      owner
        .deleteFrom('commerce_recommendation_observations')
        .where('workspace_id', 'in', workspaces)
        .execute(),
    );
  await fixtures.cleanup();
  tasks.length = 0;
  workspaces.length = 0;
});
afterAll(async () => {
  await db.destroy();
});
const emptyTarget: FrozenShelfTarget = {
  kind: 'product',
  id: randomUUID(),
  products: [],
  approved_competitors: [],
};
/** A Commerce audit whose prompt targets a Shoes category holding one frozen Acme product. */
async function shoeAudit(repetitions: number) {
  const t = await auditTenant(db, fixtures),
    foreign = await auditTenant(db, fixtures);
  workspaces.push(t.workspaceId, foreign.workspaceId);
  const scope = { workspaceId: t.workspaceId, projectId: t.projectId };
  const category = await categoryByName(db, scope, 'Shoes');
  const product = await newProduct(db, scope, 'https://shop.example/products/road');
  await db
    .updateTable('commerce_products')
    .set({ name: 'Frozen road shoe', brand: 'Acme', price: '12.50' })
    .where('id', '=', product.id)
    .execute();
  await addMembership(db, scope, product.id, category.id, null);
  await db
    .insertInto('commerce_prompt_targets')
    .values({
      id: randomUUID(),
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      prompt_id: t.promptId,
      target_kind: 'category',
      target_id: category.id,
      template_version: 'test',
      approved_at: new Date(),
      created_at: new Date(),
    })
    .execute();
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({
      project_id: t.projectId,
      prompt_ids: [t.promptId],
      engines: ['chatgpt'],
      repetitions,
      audit_scope: 'commerce',
    }),
    {},
    runtime,
  );
  return { t, foreign, product, auditId };
}
describe('frozen Commerce shelf projections', () => {
  it('retains list rank and prose boundaries across long whitespace runs', async () => {
    const gap = ' '.repeat(20_000);
    const listed = await prepareRecommendations(`1.${gap}Product A\n-${gap}Product B`, emptyTarget);
    expect(listed.map(({ span }) => [span.text, span.rank, span.orderObservable])).toEqual([
      ['Product A', 1, true],
      ['Product B', null, false],
    ]);
    const prose = await prepareRecommendations(
      `Product A${gap};${gap}; Product B. Product C`,
      emptyTarget,
    );
    expect(prose.map(({ span }) => span.text)).toEqual(['Product A', 'Product B.', 'Product C']);
  });
  it('preserves uncertainty and withholds invented rank for multi-product model extraction', async () => {
    const unresolved = await prepareRecommendations('1. Unclear product', emptyTarget, {
      model: 'fixture',
      resolve: async () => {
        throw new Error('unavailable');
      },
    });
    // A failed resolver call keeps the span as evidence and records the failure.
    expect(unresolved).toMatchObject([
      {
        span: { rank: 1, orderObservable: true },
        resolved: null,
        model: 'fixture',
        outcome: 'failed',
      },
    ]);
    const extracted = await prepareRecommendations('1. Choose either option', emptyTarget, {
      model: 'fixture',
      resolve: async () => ({
        recommendations: [
          { span: 0, title: 'A' },
          { span: 0, title: 'B' },
        ],
      }),
    });
    expect(extracted.map((row) => [row.resolved?.title, row.span.rank])).toEqual([
      ['A', null],
      ['B', null],
    ]);
    expect(observedPrice('$1,299.50', 'en-US')).toEqual({ price: 1299.5, currency: 'USD' });
    expect(observedPrice('$12.50', 'en')).toEqual({ price: 12.5, currency: '' });
  });
  // The narrow no-break space `Intl.NumberFormat('fr-FR')` groups thousands with.
  const NARROW_NBSP = String.fromCodePoint(0x202f);
  it.each([
    ['Grab it for $59.', 'en-US', 59, 'USD'],
    ['The Pro costs $129.99, the Lite less.', 'en-US', 129.99, 'USD'],
    ['Around $1,299. Worth it', 'en-US', 1299, 'USD'],
    ['Only €1.299,50; ships today', 'de-DE', 1299.5, 'EUR'],
    [`Priced at €1${NARROW_NBSP}299,50 in France`, 'fr-FR', 1299.5, 'EUR'],
    ['Swiss list: EUR 1’299.00 here', 'de-CH', 1299, 'EUR'],
    ['Listed at ₹1,23,456.', 'en-IN', 123456, 'INR'],
  ])('reads the price in %j', (span, locale, price, currency) => {
    expect(observedPrice(span, locale)).toEqual({ price, currency });
  });
  it('reads no price from malformed grouping', () => {
    expect(observedPrice('about $1,23,4 each', 'en-US')).toEqual({ price: null, currency: 'USD' });
    expect(observedPrice(`about $12${NARROW_NBSP}34 each`, 'en-US')).toEqual({
      price: null,
      currency: 'USD',
    });
  });
  it('sends one resolver call per answer, for unmatched spans with a product signal only', async () => {
    const calls: string[][] = [];
    await prepareRecommendations(
      'Shoes matter. Consider the Rival Runner. Try one at $90. Comfort is key.',
      emptyTarget,
      {
        model: 'fixture',
        resolve: async (spans) => {
          calls.push(spans);
          return { recommendations: [] };
        },
      },
    );
    expect(calls).toEqual([['Consider the Rival Runner.', 'Try one at $90.']]);
  });
  it('records whether each span needed the resolver, had none, or was left out by it', async () => {
    const answer = 'Shoes matter. Consider the Rival Runner. Try one at $90.';
    const outcomes = (rows: Awaited<ReturnType<typeof prepareRecommendations>>) =>
      rows.map((row) => [row.span.text, row.outcome, row.model]);
    expect(outcomes(await prepareRecommendations(answer, emptyTarget))).toEqual([
      ['Shoes matter.', 'not_needed', ''],
      ['Consider the Rival Runner.', 'unavailable', ''],
      ['Try one at $90.', 'unavailable', ''],
    ]);
    const partial = await prepareRecommendations(answer, emptyTarget, {
      model: 'fixture',
      resolve: async () => ({ recommendations: [{ span: 0, title: 'Rival Runner' }] }),
    });
    expect(outcomes(partial)).toEqual([
      ['Shoes matter.', 'not_needed', ''],
      ['Consider the Rival Runner.', 'resolved', 'fixture'],
      ['Try one at $90.', 'omitted', 'fixture'],
    ]);
  });
  it("accepts an AI-observed PDP only when the answer carries it and it is not the business's own", () => {
    // The sentence's full stop is not part of the URL.
    const answer = 'Try https://rival.example/p/1. Or https://www.shop.example/p/2';
    const evidence = { answer, citations: [], ownedHosts: ['shop.example'] };
    expect(resolvedCompetitorUrl('https://rival.example/p/1', evidence)).toBe(
      'https://rival.example/p/1',
    );
    // Invented by the resolver: nowhere in the answer.
    expect(resolvedCompetitorUrl('https://other.example/p/3', evidence)).toBeNull();
    // The business's own product page.
    expect(resolvedCompetitorUrl('https://www.shop.example/p/2', evidence)).toBeNull();
    // A citation alone is not an independently resolved PDP.
    expect(
      resolvedCompetitorUrl('https://rival.example/p/1', {
        ...evidence,
        citations: ['https://rival.example/p/1?utm_source=x'],
      }),
    ).toBeNull();
  });
  it('matches whole names, gives the slot to whoever the span names first, and ignores shared attributes', () => {
    const product = {
      id: randomUUID(),
      canonical_url: 'https://shop.example/p/runner',
      name: 'Acme Runner',
      brand: 'Acme',
      attributes: { colour: 'black', size: 10, series: 'Trailblazer' },
    };
    const sibling = {
      ...product,
      id: randomUUID(),
      canonical_url: 'https://shop.example/p/walker',
      name: 'Acme Walker',
      attributes: { colour: 'black' },
    };
    const target: FrozenShelfTarget = {
      kind: 'category',
      id: randomUUID(),
      products: [product, sibling],
      approved_competitors: [
        {
          id: randomUUID(),
          canonical_url: 'https://rival.example/p/1',
          product_name: 'Rival Runner',
          brand_name: 'Rival',
        },
      ],
    };
    const holder = (text: string) => {
      const match = matchRecommendation(text, target);
      if (match.product) return `owned:${match.product.name}`;
      return match.competitor ? 'competitor' : 'none';
    };
    expect(holder('The Acme Runner is the pick')).toBe('owned:Acme Runner');
    expect(holder('Rival Runner, a cheaper alternative to the Acme Runner')).toBe('competitor');
    expect(holder('The Acme Runner beats the Rival Runner')).toBe('owned:Acme Runner');
    // A prefix of a longer word is not the product.
    expect(holder('Acme Runners club meets weekly')).toBe('none');
    // Brand plus a colour both Acme products share names neither.
    expect(holder('Anything black from Acme')).toBe('none');
    expect(holder('Acme Trailblazer edition')).toBe('owned:Acme Runner');
  });
  it('distinguishes zero visibility from unavailable slot and position metrics', () => {
    const row = (values: Record<string, unknown> = {}) => ({
      id: randomUUID(),
      task_id: 'one',
      classification: 'owned',
      rank: null,
      order_observable: false,
      product_id: 'product',
      competitor_candidate_id: null,
      surface_kind: 'recommendation',
      ...values,
    });
    expect(shelfMetrics(['one'], [])).toMatchObject({
      product_visibility: 0,
      share_of_shelf: null,
      average_shelf_position: null,
      first_position_win_rate: null,
    });
    expect(shelfMetrics(['one', 'two'], [row()])).toMatchObject({
      product_visibility: 0.5,
      share_of_shelf: 1,
      average_shelf_position: null,
      first_position_win_rate: null,
    });
    // One answer naming the same product three times holds one slot, at its best rank.
    expect(
      shelfMetrics(
        ['one'],
        [
          row({ rank: 3, order_observable: true }),
          row({ rank: 1, order_observable: true }),
          row(),
          row({
            classification: 'approved_competitor',
            product_id: null,
            competitor_candidate_id: 'rival',
            rank: 2,
            order_observable: true,
          }),
        ],
      ),
    ).toMatchObject({
      share_of_shelf: 0.5,
      average_shelf_position: 1,
      first_position_win_rate: 1,
      recognized_slot_count: 2,
    });
    // Text list and carousel both rank from 1; the carousel's ranks order the execution.
    const rival = { product_id: null, competitor_candidate_id: 'rival' };
    expect(
      shelfMetrics(
        ['one'],
        [
          row({ rank: 1, order_observable: true }),
          row({ classification: 'approved_competitor', ...rival, rank: 2, order_observable: true }),
          row({
            classification: 'approved_competitor',
            ...rival,
            rank: 1,
            order_observable: true,
            surface_kind: 'shopping_result',
          }),
          row({ rank: 2, order_observable: true, surface_kind: 'shopping_result' }),
        ],
      ),
    ).toMatchObject({
      share_of_shelf: 0.5,
      average_shelf_position: 2,
      first_position_win_rate: 0,
      recognized_slot_count: 2,
    });
  });
  it('shares the shelf between owned products and approved competitors only', () => {
    const row = (classification: string, holder: string) => ({
      id: randomUUID(),
      task_id: 'one',
      classification,
      rank: null,
      order_observable: false,
      product_id: classification === 'owned' ? holder : null,
      competitor_candidate_id: classification === 'owned' ? null : holder,
      surface_kind: 'recommendation',
    });
    const owned = row('owned', 'product');
    const approved = row('approved_competitor', 'approved-rival');
    const pending = row('ai_observed_competitor', 'pending-rival');
    const rejected = row('rejected_competitor', 'rejected-rival');
    expect(shelfMetrics(['one'], [owned, pending, rejected])).toMatchObject({
      share_of_shelf: 1,
      recognized_slot_count: 1,
    });
    expect(shelfMetrics(['one'], [owned, approved, pending, rejected])).toMatchObject({
      share_of_shelf: 0.5,
      recognized_slot_count: 2,
    });
    // A shelf held only by unreviewed or rejected rivals has no slot to share.
    expect(shelfMetrics(['one'], [pending, rejected])).toMatchObject({
      product_visibility: 0,
      share_of_shelf: null,
      recognized_slot_count: 0,
    });
  });
  it('persists frozen matches, pending independent PDPs, citation provenance and replay-safe target snapshots', async () => {
    const { t, foreign, product, auditId } = await shoeAudit(1);
    const queue = new AuditQueue(db, 120),
      [claim] = await queue.claim('shelf-worker', 1, { workspaceId: t.workspaceId, auditId });
    const running = await queue.markRunning(claim!, claim!.lease_owner);
    const task = running!.task;
    tasks.push(task.id);
    await db
      .updateTable('commerce_products')
      .set({ name: 'Later edited shoe', lifecycle_state: 'archived' })
      .where('id', '=', product.id)
      .execute();
    const result: ExecutionResult = {
      logical_engine: 'chatgpt',
      transport_provider: 'openai',
      transport_model: task.transport_model,
      answer_text:
        '1. Frozen road shoe $12.50 https://evidence.example/review\n2. New rival option https://rival.example/products/new\n3. Citation-only option',
      search_used: false,
      search_events: [],
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      latency_ms: 1,
      provider_metadata: {},
      retrieved_sources: null,
      citations: [
        {
          ordinal: 1,
          url: 'https://evidence.example/review',
          title: 'Evidence',
          domain: 'evidence.example',
          start_index: null,
          end_index: null,
          cited_text: '',
        },
      ],
      normalized_usage: {
        uncached_input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        total_tokens: null,
        web_search_requests: null,
        provider_cost_microusd: null,
      },
    };
    let calls = 0;
    const derive = await prepareShelfExecution(db, task, result, {
      model: 'fixture',
      resolve: async (spans) => {
        calls++;
        // Model I/O runs after the context read, with no persistence transaction/row lock.
        return {
          recommendations: spans.map((span, index) => ({
            span: index,
            title: span.includes('Citation-only') ? 'Citation-only option' : 'New rival',
            product_url: span.includes('Citation-only')
              ? 'https://evidence.example/review'
              : 'https://rival.example/products/new',
            merchant_url: 'https://seller.example/buy',
          })),
        };
      },
    });
    // The owned span matches deterministically; the other two share one call.
    expect(calls).toBe(1);
    await expect(
      prepareShelfExecution(db, { ...task, workspace_id: foreign.workspaceId }, result, null),
    ).rejects.toThrow();
    const artifactId = await persistExecutionSuccess(db, task, claim!.lease_owner, result, derive);
    await db.transaction().execute((trx) => derive(trx, task, running!.audit, artifactId!));
    const observations = await db
      .selectFrom('commerce_recommendation_observations')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .orderBy('rank')
      .execute();
    expect(observations.map((row) => row.classification)).toEqual([
      'owned',
      'ai_observed_competitor',
      'unresolved',
    ]);
    expect(
      observations.map((row) => [row.resolver_outcome, row.resolver_template_version]),
    ).toEqual([
      ['not_needed', null],
      ['resolved', 'commerce-shelf-resolver-1'],
      ['resolved', 'commerce-shelf-resolver-1'],
    ]);
    expect(observations[0]).toMatchObject({
      product_id: product.id,
      observed_product: 'Frozen road shoe',
      artifact_id: artifactId,
      observed_price: '12.50',
      rank: 1,
    });
    const candidate = await db
      .selectFrom('commerce_competitor_candidates')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .executeTakeFirstOrThrow();
    expect(candidate).toMatchObject({
      state: 'pending',
      source_kind: 'ai_observed',
      canonical_url: 'https://rival.example/products/new',
    });
    const links = await db
      .selectFrom('commerce_observation_citations')
      .selectAll()
      .where(
        'observation_id',
        'in',
        observations.map((row) => row.id),
      )
      .execute();
    expect(links).toHaveLength(1);
    expect(links[0]?.observation_id).toBe(observations[0]!.id);
    const audit = await db
      .selectFrom('audits')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow();
    await db.transaction().execute((trx) => finalizeCommerceShelf(trx, audit));
    await db.transaction().execute((trx) => finalizeCommerceShelf(trx, audit));
    const snapshots = await db
      .selectFrom('commerce_shelf_snapshots')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .execute();
    expect(snapshots).toHaveLength(1);
    // The pending AI-observed rival holds no slot until it is approved.
    expect(snapshots[0]).toMatchObject({
      product_visibility: 1,
      share_of_shelf: 1,
      average_shelf_position: 1,
      first_position_win_rate: 1,
      successful_execution_count: 1,
    });
    expect(new Set(snapshots[0]!.source_observation_ids as string[])).toEqual(
      new Set(observations.map((row) => row.id)),
    );
    // Recreate the older writer boundary: the answer committed without shelf derivation.
    await db.deleteFrom('commerce_shelf_snapshots').where('audit_id', '=', auditId).execute();
    await db
      .deleteFrom('commerce_observation_citations')
      .where(
        'observation_id',
        'in',
        observations.map((row) => row.id),
      )
      .execute();
    await db.deleteFrom('commerce_match_passes').where('audit_id', '=', auditId).execute();
    const projections = auditProjections(db, null, {});
    await projections.finalize(t.workspaceId, auditId);
    const recovered = await db
      .selectFrom('commerce_shelf_snapshots')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .execute();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ product_visibility: 1, successful_execution_count: 1 });
    const recoveredObservations = await db
      .selectFrom('commerce_recommendation_observations')
      .select('artifact_id')
      .where('audit_id', '=', auditId)
      .execute();
    expect(recoveredObservations.length).toBeGreaterThan(0);
    expect(new Set(recoveredObservations.map((row) => row.artifact_id))).toEqual(
      new Set([artifactId]),
    );
    await projections.finalize(t.workspaceId, auditId);
    // The same answer to a branded comparison prompt names the owned brand by
    // design, so it leaves the shelf: no execution, no slot, no source.
    await db.deleteFrom('commerce_shelf_snapshots').where('audit_id', '=', auditId).execute();
    await db
      .updateTable('audit_prompt_snapshots')
      .set({ cohort: 'comparison' })
      .where('audit_id', '=', auditId)
      .execute();
    await db.transaction().execute((trx) => finalizeCommerceShelf(trx, audit));
    const branded = await db
      .selectFrom('commerce_shelf_snapshots')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .executeTakeFirstOrThrow();
    expect(branded).toMatchObject({
      product_visibility: 0,
      share_of_shelf: null,
      successful_execution_count: 0,
      source_observation_ids: [],
    });
  });
  it('ranks organic carousel cards as shopping slots and matches a repeat card by its ChatGPT product key', async () => {
    const { t, foreign, product, auditId } = await shoeAudit(3);
    const queue = new AuditQueue(db, 120),
      claims = await queue.claim('carousel-worker', 3, { workspaceId: t.workspaceId, auditId });
    expect(claims).toHaveLength(3);
    const beforeAnyMatch = new Date(Date.now() - 1000);
    const carousel = (items: Record<string, unknown>[]) => ({
      status_code: 20000,
      tasks: [
        {
          id: 'scraper-task',
          status_code: 20000,
          result: [{ items: [{ type: 'chat_gpt_products', items }] }],
        },
      ],
    });
    const card = (fields: Record<string, unknown>) => ({
      type: 'chat_gpt_products_element',
      ...fields,
    });
    const answer = (task: AuditTask, envelope: unknown): ExecutionResult => ({
      logical_engine: 'chatgpt',
      transport_provider: 'openai',
      transport_model: task.transport_model,
      answer_text: 'These are the top picks.',
      search_used: false,
      search_events: [],
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      latency_ms: 1,
      provider_metadata: { raw_response: envelope },
      retrieved_sources: null,
      citations: [],
      normalized_usage: {
        uncached_input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        total_tokens: null,
        web_search_requests: null,
        provider_cost_microusd: null,
      },
    });
    const envelopes = [
      carousel([
        { type: 'chat_gpt_ad', title: 'Sponsored runner', url: 'https://ads.example/runner' },
        card({
          title: 'Acme Road Runner in Grey, Size: 9 | …',
          url: 'https://shop.example/products/road?utm_source=chatgpt.com',
          product_id: 'own-key',
          price: 12.5,
          currency: 'USD',
          merchants: 'Acme Store',
          tag: 'Best overall value',
          images: ['https://images.example/own.jpg'],
        }),
        card({
          title: 'Rival Trail Runner',
          url: 'https://rival.example/products/trail?utm_source=chatgpt.com',
          product_id: 'rival-key',
          merchants: 'Rival',
        }),
      ]),
    ];
    // A later answer names both by product key only, under other titles.
    const keysOnly = carousel([
      card({ title: 'Another listing for the rival', product_id: 'rival-key' }),
      card({ title: 'Renamed listing', product_id: 'own-key' }),
    ]);
    // The same cards in an answer captured before any key was matched, derived last.
    envelopes.push(keysOnly, keysOnly);
    const capturedAt = [undefined, undefined, beforeAnyMatch];
    const taskIds: string[] = [];
    const running: AuditTask[] = [];
    for (const [index, claim] of claims.entries()) {
      const marked = await queue.markRunning(claim, claim.lease_owner);
      const task = marked!.task;
      tasks.push(task.id);
      taskIds.push(task.id);
      running.push(task);
      const result = answer(task, envelopes[index]);
      const derive = await prepareShelfExecution(db, task, result, null);
      const artifactId = await persistExecutionSuccess(
        db,
        task,
        claim.lease_owner,
        result,
        derive,
        {
          at: capturedAt[index],
        },
      );
      await db.transaction().execute((trx) => derive(trx, task, marked!.audit, artifactId!));
    }
    const slots = await db
      .selectFrom('commerce_recommendation_observations')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .where('surface_kind', '=', 'shopping_result')
      .orderBy('rank')
      .execute();
    const slotsOf = (taskId: string) => slots.filter((row) => row.task_id === taskId);
    const candidate = await db
      .selectFrom('commerce_competitor_candidates')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .executeTakeFirstOrThrow();
    expect(candidate).toMatchObject({
      state: 'pending',
      source_kind: 'ai_observed',
      canonical_url: 'https://rival.example/products/trail',
      product_name: 'Rival Trail Runner',
    });
    // The sponsored card holds no slot; the organic cards rank from 1.
    expect(slotsOf(taskIds[0]!)).toMatchObject([
      {
        rank: 1,
        order_observable: true,
        classification: 'owned',
        product_id: product.id,
        observed_product: 'Frozen road shoe',
        observed_title: 'Acme Road Runner in Grey, Size: 9 | …',
        observed_price: '12.50',
        observed_currency: 'USD',
        merchant_url: 'https://shop.example/products/road?utm_source=chatgpt.com',
        merchant_domain: 'shop.example',
        observed_tag: 'Best overall value',
        observed_merchant_name: 'Acme Store',
        observed_external_product_id: 'own-key',
        observed_image_url: 'https://images.example/own.jpg',
        resolver_outcome: 'not_needed',
        model_version: '',
      },
      {
        rank: 2,
        classification: 'ai_observed_competitor',
        competitor_candidate_id: candidate.id,
        observed_price: null,
        observed_currency: '',
        observed_tag: null,
        observed_external_product_id: 'rival-key',
      },
    ]);
    expect(
      slotsOf(taskIds[1]!).map((row) => [
        row.rank,
        row.classification,
        row.product_id,
        row.competitor_candidate_id,
      ]),
    ).toEqual([
      [1, 'ai_observed_competitor', null, candidate.id],
      [2, 'owned', product.id, null],
    ]);
    expect(
      slotsOf(taskIds[2]!).map((row) => [
        row.rank,
        row.classification,
        row.product_id,
        row.competitor_candidate_id,
      ]),
    ).toEqual([
      [1, 'unresolved', null, null],
      [2, 'unresolved', null, null],
    ]);
    // Text spans stay recommendations beside the carousel.
    const surfaces = await db
      .selectFrom('commerce_recommendation_observations')
      .select('surface_kind')
      .where('workspace_id', '=', t.workspaceId)
      .where('audit_id', '=', auditId)
      .where('task_id', '=', taskIds[0]!)
      .execute();
    expect(surfaces.map((row) => row.surface_kind).sort()).toEqual([
      'recommendation',
      'shopping_result',
      'shopping_result',
    ]);
    // Another workspace cannot read this audit's shelf context.
    await expect(
      prepareShelfExecution(
        db,
        { ...running[0]!, workspace_id: foreign.workspaceId },
        answer(running[0]!, envelopes[0]),
        null,
      ),
    ).rejects.toThrow();
  });
});
