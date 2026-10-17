import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createAudits } from '../src/audits/creation.ts';
import { AuditQueue } from '../src/queue/audit-queue.ts';
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
    await db.deleteFrom('provider_attempts').where('task_id', 'in', tasks).execute();
  }
  if (workspaces.length)
    await db
      .deleteFrom('commerce_recommendation_observations')
      .where('workspace_id', 'in', workspaces)
      .execute();
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
    expect(unresolved).toMatchObject([
      { span: { rank: 1, orderObservable: true }, resolved: null, model: '' },
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
  });
  it('persists frozen matches, pending independent PDPs, citation provenance and replay-safe target snapshots', async () => {
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
        repetitions: 1,
        audit_scope: 'commerce',
      }),
      {},
      runtime,
    );
    const queue = new AuditQueue(db, 120),
      [claim] = await queue.claim('shelf-worker', 1, { workspaceId: t.workspaceId, auditId });
    const running = await queue.markRunning(claim!, 'shelf-worker');
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
    const artifactId = await persistExecutionSuccess(db, task, 'shelf-worker', result, derive);
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
    expect(snapshots[0]).toMatchObject({
      product_visibility: 1,
      share_of_shelf: 0.5,
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
    await db
      .deleteFrom('commerce_recommendation_observations')
      .where('audit_id', '=', auditId)
      .execute();
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
  });
});
