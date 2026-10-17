import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { policy } from '../src/config.ts';
import { importCatalog } from '../src/commerce/import.ts';
import { enqueueCatalogProjection, projectCatalog } from '../src/commerce/projection.ts';
import {
  categoryTitle,
  pageIdentity,
  productCategories,
  productFacts,
  readFacts,
} from '../src/commerce/projection-facts.ts';
import { catalog } from '../src/commerce/reads.ts';
import { record } from '../src/db/json.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { commerceFixture } from './commerce-support.ts';
import { freezeCommerceContext } from '../src/commerce/audit-context.ts';
import { enqueue } from './referral-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
type Seed = {
  workspaceId: string;
  projectId: string;
  userId: string;
  analyses: string[];
  tasks: string[];
};
const seeds: Seed[] = [];
/** Native fixtures seed catalog evidence; the analyzer owner enqueues its projections. */
async function seed() {
  const value = await commerceFixture<Omit<Seed, 'tasks'>>('seed');
  const tasks = await projectionTasks(value);
  const seeded = { ...value, tasks: tasks.map((task) => task.id) };
  seeds.push(seeded);
  return seeded;
}
async function projectionTasks(scope: Omit<Seed, 'tasks'>) {
  for (const analysisId of scope.analyses) await enqueueCatalogProjection(db, scope, analysisId);
  return db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('task_kind', '=', 'commerce_catalog_projection')
    .execute();
}
async function businessContext(scope: Omit<Seed, 'tasks'>, context: Record<string, unknown>) {
  await db
    .updateTable('brand_profiles')
    .set({ business_context: JSON.stringify(context) })
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .execute();
}
afterAll(async () => {
  for (const s of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', s.workspaceId).execute();
    await db.deleteFrom('users').where('id', '=', s.userId).execute();
  }
  await db.destroy();
});

const context = { db, maxAttempts: 3, checkCancelled: async () => {} };
async function execute(taskId: string) {
  const task = await db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  await projectCatalog(task, context);
}

describe('catalog projection PostgreSQL boundary', () => {
  it('queues one projection per analysis only for a catalog-selling business model', async () => {
    const scope = await commerceFixture<Omit<Seed, 'tasks'>>('seed');
    seeds.push({ ...scope, tasks: [] });
    await businessContext(scope, { business_model: 'b2b_saas' });
    expect(await projectionTasks(scope)).toEqual([]);
    await businessContext(scope, {
      business_model: 'b2b_saas',
      secondary_business_models: ['retail'],
    });
    await projectionTasks(scope);
    const tasks = await projectionTasks(scope);
    expect(tasks.map((task) => record(task.payload).source_analysis_id).sort()).toEqual(
      [...scope.analyses].sort(),
    );
  }, 20_000);
  it.each([false, true])(
    'links category and product in either order (product first: %s), preserving evidence on retry',
    async (productFirst) => {
      const s = await seed();
      const tasks = await db
        .selectFrom('analytics_tasks')
        .selectAll()
        .where('workspace_id', '=', s.workspaceId)
        .execute();
      const byAnalysis = new Map(
        tasks.map((task) => [
          (task.payload as { source_analysis_id: string }).source_analysis_id,
          task.id,
        ]),
      );
      const categoryTask = byAnalysis.get(s.analyses[0]!)!;
      const productTask = byAnalysis.get(s.analyses[1]!)!;
      const order = productFirst ? [productTask, categoryTask] : [categoryTask, productTask];
      for (const task of order) await execute(task);
      await Promise.all([execute(productTask), execute(productTask)]);
      const result = await catalog(db, s);
      expect(result.products).toHaveLength(1);
      expect(result.products[0]).toMatchObject({
        name: 'Widget',
        price: 12.5,
        canonical_url: 'https://example.com/products/widget',
      });
      const tools = result.categories.find((row) => row.name === 'Tools')!;
      expect(tools.product_count).toBe(1);
      expect(result.products[0]!.category_ids).toEqual([tools.id]);
      const evidence = await db
        .selectFrom('commerce_product_observations')
        .selectAll()
        .where('workspace_id', '=', s.workspaceId)
        .execute();
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({
        source_analysis_id: s.analyses[1],
        projector_version: policy.commerce.projector_version,
      });
      expect(result.products[0]!.field_sources.price).toMatchObject({
        source_id: s.analyses[1],
        artifact_id: evidence[0]!.source_artifact_id,
        evidence_path: 'structured_data.product.price',
      });
      await db
        .updateTable('analytics_tasks')
        .set({ status: 'succeeded' })
        .where('workspace_id', '=', s.workspaceId)
        .execute();
    },
    20_000,
  );
  it('claims queued projections, honors CSV priority in a race, and leaves non-analytics work to its owner', async () => {
    const s = await seed();
    const otherTask = await enqueue(db, {
      ...s,
      kind: 'brand_discovery',
      payload: {},
    });
    await Promise.all([
      drainWorkspace(db, s.workspaceId, { owner: 'commerce-ts-test' }),
      importCatalog(db, s, {
        filename: 'catalog.csv',
        content_type: 'text/csv',
        content: 'canonical_url,name,price\nhttps://example.com/products/widget,Edited,44\n',
      }),
    ]);
    const result = await catalog(db, s);
    expect(result.products[0]).toMatchObject({ name: 'Edited', price: 44 });
    const tasks = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', s.workspaceId)
      .execute();
    expect(
      tasks
        .filter((row) => row.task_kind === 'commerce_catalog_projection')
        .map((row) => row.status),
    ).toEqual(['succeeded', 'succeeded']);
    expect(tasks.find((row) => row.id === otherTask)!.status).toBe('queued');
    const id = result.categories.find((row) => row.name === 'Tools')!.id;
    const seeded = await commerceFixture<{ promptId: string }>(
      'prompt',
      s.workspaceId,
      s.projectId,
      id,
      'category',
    );
    // Native audit admission reads the projected catalog with provenance.
    await db
      .updateTable('commerce_prompt_targets')
      .set({ approved_at: new Date() })
      .where('prompt_id', '=', seeded.promptId)
      .execute();
    const frozen = await freezeCommerceContext(db, s, [seeded.promptId]);
    expect(frozen.targets[0]!.products[0]).toMatchObject({
      price: 44,
      field_sources: { name: { kind: 'csv' } },
    });
  }, 20_000);
  it('projects a shelf onto the category owning its name when another row holds its URL', async () => {
    const s = await seed();
    await importCatalog(db, s, {
      filename: 'catalog.csv',
      content_type: 'text/csv',
      content: 'canonical_url,name,sku,category\nhttps://example.com/p/x,X,X1,tools\n',
    });
    const stale = randomUUID();
    await db
      .insertInto('commerce_categories')
      .values({
        id: stale,
        workspace_id: s.workspaceId,
        project_id: s.projectId,
        name: 'Old tools',
        normalized_name: 'old tools',
        role: 'unknown',
        canonical_url: 'https://example.com/collections/tools',
        field_sources: '{}',
        source_analysis_id: null,
        projector_version: '',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    for (const task of s.tasks) await execute(task);
    const result = await catalog(db, s);
    const tools = result.categories.find((row) => row.name === 'Tools')!;
    expect(tools).toMatchObject({ canonical_url: 'https://example.com/collections/tools' });
    expect(result.categories.find((row) => row.id === stale)!.name).toBe('Old tools');
    const widget = result.products.find((row) => row.name === 'Widget')!;
    expect(widget.category_ids).toEqual([tools.id]);
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'succeeded' })
      .where('workspace_id', '=', s.workspaceId)
      .execute();
  }, 20_000);
  it('rejects foreign source evidence and does not create catalog rows', async () => {
    const own = await seed();
    const foreign = await seed();
    const task = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('id', '=', own.tasks[0]!)
      .executeTakeFirstOrThrow();
    // Terminal: a retry cannot find it either, so the task must not spend its attempts.
    await expect(
      projectCatalog({ ...task, payload: { source_analysis_id: foreign.analyses[1]! } }, context),
    ).rejects.toMatchObject({ code: 'commerce_source_missing' });
    expect((await catalog(db, own)).products).toEqual([]);
    for (const s of [own, foreign])
      await db
        .updateTable('analytics_tasks')
        .set({ status: 'cancelled' })
        .where('workspace_id', '=', s.workspaceId)
        .execute();
  }, 20_000);
});

describe('catalog projection outcomes', () => {
  it('skips an unidentifiable product page and keeps uncategorized products without a sentinel category', async () => {
    const sold = await seed();
    const artifact = await db
      .selectFrom('site_page_analyses')
      .select('artifact_id')
      .where('id', '=', sold.analyses[1]!)
      .executeTakeFirstOrThrow();
    // A sold-out PDP: no SKU, no price, no product cards. As a "shelf" it
    // would take its own heading's name and claim products it does not list.
    await db
      .updateTable('site_fetch_artifacts')
      .set({
        normalized_facts: sql`jsonb_set(normalized_facts, '{structured_data}', '{}'::jsonb)`,
      })
      .where('id', '=', artifact.artifact_id)
      .execute();
    for (const task of [...sold.tasks].reverse()) await execute(task);
    const soldCatalog = await catalog(db, sold);
    expect(soldCatalog.products).toEqual([]);
    expect(soldCatalog.categories.map((row) => row.name)).toEqual(['Tools']);

    const lone = await seed();
    for (const task of lone.tasks) {
      const row = await db
        .selectFrom('analytics_tasks')
        .select('payload')
        .where('id', '=', task)
        .executeTakeFirstOrThrow();
      if (record(row.payload).source_analysis_id === lone.analyses[1]) await execute(task);
    }
    const loneCatalog = await catalog(db, lone);
    expect(loneCatalog.products.map((row) => [row.name, row.category_ids])).toEqual([
      ['Widget', []],
    ]);
    expect(
      await db
        .selectFrom('commerce_categories')
        .select('name')
        .where('workspace_id', '=', lone.workspaceId)
        .execute(),
    ).toEqual([]);
    for (const s of [sold, lone])
      await db
        .updateTable('analytics_tasks')
        .set({ status: 'succeeded' })
        .where('workspace_id', '=', s.workspaceId)
        .execute();
  }, 20_000);
  it("reports live projections, then only the latest crawl's failures", async () => {
    const s = await seed();
    expect((await catalog(db, s)).projection).toEqual({ applies: true, in_flight: 2, failed: 0 });
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'failed' })
      .where('id', '=', s.tasks[0]!)
      .execute();
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'succeeded' })
      .where('id', '=', s.tasks[1]!)
      .execute();
    expect((await catalog(db, s)).projection).toEqual({ applies: true, in_flight: 0, failed: 1 });
    await businessContext(s, { business_model: 'b2b_saas' });
    expect((await catalog(db, s)).projection.applies).toBe(false);
  }, 20_000);
});

describe('projection decisions over stored facts', () => {
  it('trusts canonical declarations only on the delivered site and resolves relative declarations after redirects', () => {
    const base = 'https://shop.example.com/collections/all/products/widget?variant=1';
    expect(pageIdentity(readFacts({ canonical_url: '/products/widget' }), base)).toBe(
      'https://shop.example.com/products/widget',
    );
    expect(pageIdentity(readFacts({ canonical_url: 'https://attacker.example.net/p' }), base)).toBe(
      'https://shop.example.com/collections/all/products/widget',
    );
    expect(
      pageIdentity(
        readFacts({ canonical_url: 'https://other.myshopify.com/products/widget' }),
        'https://mine.myshopify.com/products/widget',
      ),
    ).toBe('https://mine.myshopify.com/products/widget');
    expect(
      pageIdentity(
        readFacts({ canonical_url: './widget' }),
        'https://shop.example.com/products/old',
      ),
    ).toBe('https://shop.example.com/products/widget');
  });
  it.each(['from $29.99', 'up to $40', '$40 $20', 'Save 20%', '$1,23,4'])(
    'does not invent product identity from an ambiguous price: %s',
    (visible) => {
      const projected = productFacts(
        readFacts({ title: 'Collection', commerce: { visible_price: visible } }),
        'https://shop.example.com/c',
      );
      expect(projected.identified).toBe(false);
      expect(projected.values.price).toBeNull();
    },
  );
  it('uses structured prices before visible prices and rejects invalid stored facts', () => {
    const projected = productFacts(
      readFacts({
        title: 'Widget',
        structured_data: { product: { price: ['12.50'], price_currency: ['USD'] } },
        commerce: { visible_price: '$99.99' },
      }),
      'https://shop.example.com/p',
    );
    expect(projected.values).toMatchObject({ price: 12.5, currency: 'USD', attributes: {} });
    expect(
      productFacts(
        readFacts({ title: 'Widget', commerce: { visible_price: '€1.299,50' } }),
        'https://shop.example.com/p',
      ).values.price,
    ).toBe(1299.5);
    expect(
      productFacts(
        readFacts({
          title: 'Collection',
          commerce: { visible_price: '$50', visible_price_context: 'free shipping over $50' },
        }),
        'https://shop.example.com/c',
      ).identified,
    ).toBe(false);
    expect(() => readFacts({ commerce: [] })).toThrow();
  });
  it('takes meaningful category names and keeps a linked ancestor leaf but drops product and index crumbs', () => {
    const facts = readFacts({
      title: 'Dresses | Brand',
      commerce: {
        breadcrumbs: ['Home', '/', 'Categories', '/', 'Dresses'],
        breadcrumb_links: [{ title: 'Dresses', url: '/collections/dresses' }],
      },
    });
    expect(categoryTitle(facts, '')).toBe('Dresses');
    expect(productCategories(facts, 'https://shop.example.com/products/dress', [])).toEqual([
      'Dresses',
    ]);
    expect(
      productCategories(
        readFacts({ commerce: { breadcrumbs: ['Home', '/', 'Dresses', '/', 'Linen dress'] } }),
        'https://shop.example.com/products/dress',
        [],
      ),
    ).toEqual(['Dresses']);
    expect(
      categoryTitle(
        readFacts({ commerce: { breadcrumbs: ['/', '»'] }, headings: { h1_texts: ['Tools'] } }),
        '',
      ),
    ).toBe('Tools');
    // An index crumb or the platform default names no shelf.
    expect(
      categoryTitle(
        readFacts({
          commerce: { breadcrumbs: ['Tools', 'Shop all', 'Uncategorized'] },
          headings: { h1_texts: ['Shop all'] },
        }),
        '',
      ),
    ).toBe('Tools');
  });
});
