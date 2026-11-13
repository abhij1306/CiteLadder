import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { applyImport, stageImport } from '../src/commerce/import.ts';
import { productMetrics } from '../src/commerce/products.ts';
import { catalog } from '../src/commerce/reads.ts';
import { fetchShopifyStore } from '../src/commerce/shopify-store.ts';
import { FetchError, type WebsiteFetcher } from '../src/safe-fetch.ts';
import { importCatalog } from './commerce-support.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/catalog-sources/${name}`, import.meta.url), 'utf8');
const scopeOf = (t: Tenant) => ({ workspaceId: t.workspaceId, projectId: t.projectId });
const TEMPLATE = fixture('template.csv');

async function categoryTree(t: Tenant) {
  const rows = await db
    .selectFrom('commerce_categories as c')
    .leftJoin('commerce_categories as p', 'p.id', 'c.parent_category_id')
    .select(['c.name', 'p.name as parent'])
    .where('c.workspace_id', '=', t.workspaceId)
    .where('c.project_id', '=', t.projectId)
    .orderBy('c.name')
    .execute();
  return rows.map((row) => [row.name, row.parent]);
}

async function products(t: Tenant) {
  return db
    .selectFrom('commerce_products')
    .select(['id', 'name', 'canonical_url', 'price', 'price_max', 'image_url'])
    .where('workspace_id', '=', t.workspaceId)
    .where('project_id', '=', t.projectId)
    .orderBy('name')
    .execute();
}

describe('the category review step', () => {
  it('shows the proposed tree before any product goes live, then writes the confirmed tree', async () => {
    const t = await fixtures.tenant();
    const scope = scopeOf(t);
    const staged = await stageImport(db, scope, {
      format: 'csv',
      content: TEMPLATE,
      label: 'catalog.csv',
    });
    expect(staged).toMatchObject({
      source_format: 'csv',
      source_label: 'catalog.csv',
      products: 2,
      rejected: 2,
      result: null,
    });
    expect(staged.categories.map((node) => [node.key, node.parent_key, node.depth])).toEqual([
      ['footwear', null, 0],
      ['running', 'footwear', 1],
      ['trail', 'running', 2],
      ['sale', null, 0],
    ]);
    expect(await products(t)).toEqual([]);
    expect(await categoryTree(t)).toEqual([]);

    // The person leaves "Sale" out.
    const result = await applyImport(db, scope, staged.import_id, ['Sale']);
    expect(result).toEqual({
      import_id: staged.import_id,
      created: 2,
      updated: 0,
      unchanged: 0,
      rejected: 2,
      row_outcomes: [
        {
          row_number: 4,
          status: 'rejected',
          product_id: null,
          error_code: 'invalid_row',
          detail: 'Price "$12" is not a number with an optional currency code',
        },
        {
          row_number: 5,
          status: 'rejected',
          product_id: null,
          error_code: 'invalid_row',
          detail: 'title is required',
        },
        {
          row_number: 2,
          status: 'created',
          product_id: expect.any(String),
          error_code: '',
          detail: '',
        },
        {
          row_number: 3,
          status: 'created',
          product_id: expect.any(String),
          error_code: '',
          detail: '',
        },
      ],
    });
    expect(await categoryTree(t)).toEqual([
      ['Footwear', null],
      ['Running', 'Footwear'],
      ['Trail', 'Running'],
    ]);
    expect(await products(t)).toEqual([
      expect.objectContaining({ name: 'Road Runner', price: '89.50', image_url: '' }),
      expect.objectContaining({
        name: 'Trail Runner',
        price: '120.00',
        image_url: 'https://cdn.example/trail.png',
      }),
    ]);
    // The Products sidebar nests by the parent; every category on a path holds the product.
    const read = await catalog(db, scope);
    const byName = new Map(read.categories.map((row) => [row.name, row]));
    expect(byName.get('Running')).toMatchObject({
      parent_id: byName.get('Footwear')!.id,
      product_count: 2,
    });
    expect(byName.get('Trail')).toMatchObject({
      parent_id: byName.get('Running')!.id,
      product_count: 1,
    });
    // The new catalog revision queues the 30-day answer backfill.
    const revision = await db
      .selectFrom('commerce_catalog_revisions')
      .select(['id', 'source_kind', 'source_id'])
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .executeTakeFirstOrThrow();
    expect(revision).toMatchObject({ source_kind: 'import', source_id: staged.import_id });
    const backfill = await db
      .selectFrom('analytics_tasks')
      .select('payload')
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', 'commerce_answer_matching')
      .execute();
    expect(backfill).toEqual([{ payload: { catalog_revision_id: revision.id } }]);
  });
});

describe('re-imports', () => {
  it('returns the same import for the same content and leaves an unchanged catalog unchanged', async () => {
    const t = await fixtures.tenant();
    const scope = scopeOf(t);
    const label = 'catalog.csv';
    const first = await stageImport(db, scope, { format: 'csv', content: TEMPLATE, label });
    const again = await stageImport(db, scope, { format: 'csv', content: TEMPLATE, label });
    expect(again.import_id).toBe(first.import_id);
    const applied = await applyImport(db, scope, first.import_id, []);
    expect(await applyImport(db, scope, first.import_id, [])).toEqual(applied);
    expect(
      (await stageImport(db, scope, { format: 'csv', content: TEMPLATE, label })).result,
    ).toEqual(applied);
    // The same products in a different file: matched, nothing changes.
    const repeat = await importCatalog(db, scope, `${TEMPLATE}\n`);
    expect(repeat).toMatchObject({ created: 0, updated: 0, unchanged: 2, rejected: 2 });
    const observations = await db
      .selectFrom('commerce_product_observations')
      .select('csv_import_id')
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .execute();
    expect(observations).toHaveLength(4);
    expect(await products(t)).toHaveLength(2);
    const revisions = await db
      .selectFrom('commerce_catalog_revisions')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .execute();
    expect(revisions).toHaveLength(1);
  });

  it('reports a later row repeating a product of the same file, categories included, as unchanged', async () => {
    const t = await fixtures.tenant();
    const row = 'Trail,Acme,TR-1,Footwear > Running';
    const result = await importCatalog(
      db,
      scopeOf(t),
      `title,brand,sku,category\n${row}\n${row}\n`,
    );
    expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 1, rejected: 0 });
  });

  it('updates the product a SKU matches under a different URL and records that URL as an alias', async () => {
    const t = await fixtures.tenant();
    const scope = scopeOf(t);
    await importCatalog(
      db,
      scope,
      'title,brand,sku,link\nTrail,Acme,TR-1,https://shop.example/products/trail\n',
    );
    const moved = await importCatalog(
      db,
      scope,
      'title,brand,sku,link,price\nTrail Runner,Acme,TR-1,https://shop.example/trail-v2,99\n',
    );
    expect(moved).toMatchObject({ created: 0, updated: 1 });
    expect(await products(t)).toEqual([
      expect.objectContaining({
        name: 'Trail Runner',
        canonical_url: 'https://shop.example/products/trail',
        price: '99.00',
      }),
    ]);
    const latest = await db
      .selectFrom('commerce_product_observations')
      .select('observed_fields')
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .where('csv_import_id', '=', moved.import_id)
      .executeTakeFirstOrThrow();
    expect(latest.observed_fields).toMatchObject({ alias_url: 'https://shop.example/trail-v2' });
  });
});

describe('Merchant Center feeds', () => {
  it('turn an item group into one product whose catalog price is the variant range', async () => {
    const t = await fixtures.tenant();
    const scope = scopeOf(t);
    const result = await importCatalog(
      db,
      scope,
      fixture('merchant-center.xml'),
      'merchant_center',
    );
    expect(result).toMatchObject({ created: 2, rejected: 0 });
    const page = await productMetrics(db, scope, {
      source: 'catalog',
      category: null,
      windowDays: 30,
      engine: null,
      promptSet: null,
      q: null,
      sort: 'name',
      cursor: null,
      limit: 10,
    });
    expect(page.items.map((row) => [row.name, row.catalog_price])).toEqual([
      ['Trail Runner - Size 9', { min: 119, max: 129, currency: 'EUR' }],
      ['Wool Sock', { min: 12, max: 12, currency: 'EUR' }],
    ]);
  });
});

describe('Shopify storefronts', () => {
  const PAGE = fixture('shopify-products.json');
  const storefront =
    (calls: string[], redirectTo?: string): WebsiteFetcher =>
    async (url, options) => {
      calls.push(url);
      if (redirectTo) await options.authorize?.(new URL(redirectTo));
      return { url, status: 200, contentType: 'application/json', body: Buffer.from(PAGE) };
    };

  it('fetch the store’s products.json page by page and import its products', async () => {
    const t = await fixtures.tenant();
    const scope = scopeOf(t);
    const calls: string[] = [];
    const store = await fetchShopifyStore(
      db,
      scope,
      'https://Acme.myshopify.com/',
      storefront(calls),
    );
    // Two products fill less than a page, so one page is the whole catalog.
    expect(calls).toEqual(['https://acme.myshopify.com/products.json?limit=250&page=1']);
    const staged = await stageImport(db, scope, {
      format: 'shopify',
      content: store.content,
      label: store.host,
    });
    expect(staged).toMatchObject({ source_format: 'shopify', source_label: 'acme.myshopify.com' });
    expect(staged.categories.map((node) => node.name)).toEqual(['Running Shoes', 'Sale', 'Trail']);
    const result = await applyImport(db, scope, staged.import_id, ['trail', 'sale']);
    expect(result).toMatchObject({ created: 2, rejected: 0 });
    expect(await categoryTree(t)).toEqual([['Running Shoes', null]]);
    expect(await products(t)).toEqual([
      expect.objectContaining({
        name: 'Trail Runner',
        canonical_url: 'https://acme.myshopify.com/products/trail-runner',
        price: '119.00',
        price_max: '129.00',
      }),
      expect.objectContaining({ name: 'Wool Sock', price: '12.00', price_max: null }),
    ]);
  });

  it('fetch only the project’s own hosts or a myshopify store, redirects included', async () => {
    const t = await fixtures.tenant({ websiteUrl: 'https://acme.example' });
    const scope = scopeOf(t);
    const calls: string[] = [];
    await expect(
      fetchShopifyStore(db, scope, 'rival.example', storefront(calls)),
    ).rejects.toMatchObject({ status: 422, code: 'commerce_store_not_allowed' });
    expect(calls).toEqual([]);
    expect((await fetchShopifyStore(db, scope, 'shop.acme.example', storefront(calls))).host).toBe(
      'shop.acme.example',
    );
    await expect(
      fetchShopifyStore(db, scope, 'acme.example', storefront([], 'https://rival.example/')),
    ).rejects.toMatchObject({
      status: 422,
      code: 'commerce_store_unavailable',
      message: `The store could not be read (${new FetchError('out_of_scope').code})`,
    });
  });
});

describe('workspace boundaries', () => {
  it('never applies or reveals another workspace’s import', async () => {
    const owner = await fixtures.tenant();
    const other = await fixtures.tenant();
    const staged = await stageImport(db, scopeOf(owner), {
      format: 'csv',
      content: TEMPLATE,
      label: 'catalog.csv',
    });
    await expect(applyImport(db, scopeOf(other), staged.import_id, [])).rejects.toMatchObject({
      status: 404,
    });
    // The other project's own project id with the owner's workspace is not the owner's import either.
    await expect(
      applyImport(
        db,
        { workspaceId: owner.workspaceId, projectId: other.projectId },
        staged.import_id,
        [],
      ),
    ).rejects.toMatchObject({ status: 404 });
    // The same file in another workspace is that workspace's own import.
    const theirs = await stageImport(db, scopeOf(other), {
      format: 'csv',
      content: TEMPLATE,
      label: 'catalog.csv',
    });
    expect(theirs.import_id).not.toBe(staged.import_id);
    expect(theirs.result).toBeNull();
    expect(await products(owner)).toEqual([]);
    expect(await products(other)).toEqual([]);
  });
});
