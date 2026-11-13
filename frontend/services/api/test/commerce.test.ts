import { randomUUID } from 'node:crypto';
import type {
  BuyerPrompt,
  CatalogImport,
  CatalogImportStage,
  CommerceCatalog,
  CommerceProductDetail,
  CompetitorCandidate,
  CompetitorDiscoveryTask,
} from '@citeladder/contracts/commerce-suite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { commerceFixture } from './commerce-support.ts';
import { freezeCommerceContext } from '../src/commerce/audit-context.ts';
import { enqueue } from './referral-fixtures.ts';
import { actionRow, opportunityRow } from './opportunity-fixtures.ts';
import { prompt } from './prompt-fixtures.ts';
import { updateActionStatus } from '../src/opportunities/actions.ts';
import { TEST_SESSION_COOKIE, asOwner, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const config = testConfig();
const app = createApp(config, db);
let t: Tenant;
const tenants: Tenant[] = [];
beforeEach(async () => {
  t = await fixtures.tenant();
  tenants.push(t);
});
afterAll(async () => {
  for (const tenant of tenants) {
    await db.deleteFrom('opportunities').where('workspace_id', '=', tenant.workspaceId).execute();
    await db.deleteFrom('actions').where('workspace_id', '=', tenant.workspaceId).execute();
  }
  for (const tenant of tenants)
    await asOwner((owner) =>
      owner
        .deleteFrom('commerce_recommendation_observations')
        .where('workspace_id', '=', tenant.workspaceId)
        .execute(),
    );
  for (const tenant of tenants)
    await db
      .deleteFrom('commerce_shelf_snapshots')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
  await fixtures.cleanup();
  await db.destroy();
});

async function call<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    user?: string;
    workspace?: string;
    anonymous?: boolean;
  } = {},
) {
  const token = await sessionToken({ sub: options.user ?? t.userId, ver: 0 });
  const response = await app.request(`/api/v1/projects/${t.projectId}/commerce${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-workspace-id': options.workspace ?? t.workspaceId,
      ...(options.anonymous ? {} : { cookie: `${TEST_SESSION_COOKIE}=${token}` }),
      'content-type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}
const csv =
  'link,title,brand,price,sku,category\nhttps://shop.example/products/one,"One, large",Acme,19.25,A1,Tools\n';
const stageCsv = (content = csv) =>
  call<CatalogImportStage>('/catalog/imports', {
    method: 'POST',
    body: { source: 'csv', content, filename: 'catalog.csv' },
  });
/** Stage the CSV and apply it with every proposed category. */
const importCsv = async (content = csv) => {
  const staged = await stageCsv(content);
  expect(staged.status).toBe(201);
  return call<CatalogImport>(`/catalog/imports/${staged.body.import_id}/apply`, {
    method: 'POST',
    body: { excluded_categories: [] },
  });
};

describe('Commerce workspace boundaries', () => {
  const routes = [
    ['/catalog', 'GET', undefined],
    ['/catalog/projection', 'GET', undefined],
    ['/products?source=all', 'GET', undefined],
    ['/catalog/imports', 'POST', { source: 'csv', content: csv, filename: 'catalog.csv' }],
    [`/catalog/imports/${randomUUID()}/apply`, 'POST', { excluded_categories: [] }],
    ['/competitors', 'GET', undefined],
    ['/competitors/discoveries', 'GET', undefined],
    ['/competitors/discover', 'POST', { targets: [{ kind: 'product', id: randomUUID() }] }],
    ['/competitors/discoveries/run', 'POST', { task_ids: [randomUUID()] }],
    [`/competitors/${randomUUID()}`, 'PATCH', { decision: 'approved' }],
    ['/buyer-prompts', 'GET', undefined],
    [`/buyer-prompts/${randomUUID()}`, 'PATCH', { approved: true }],
    [`/products/${randomUUID()}`, 'GET', undefined],
    [`/products/${randomUUID()}`, 'PATCH', { name: 'Renamed' }],
    [`/products/${randomUUID()}/lifecycle`, 'PUT', { lifecycle_state: 'archived' }],
  ] as const;
  it('requires membership, the active project workspace, and write capability on every route', async () => {
    const outsider = await fixtures.user();
    const viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    const otherWorkspace = await fixtures.joinedWorkspace(t.userId);
    for (const [path, method, body] of routes) {
      expect((await call(path, { method, body, anonymous: true })).status).toBe(404);
      expect((await call(path, { method, body, user: outsider })).status).toBe(404);
      expect((await call(path, { method, body, workspace: otherWorkspace })).status).toBe(404);
      if (method !== 'GET')
        expect((await call(path, { method, body, user: viewer })).status).toBe(403);
    }
    expect((await call('/catalog', { user: viewer })).status).toBe(200);
  });
});

describe('CSV evidence and catalog', () => {
  it('executes only admitted discovery IDs and retains one attempt across concurrent requests', async () => {
    await importCsv();
    const product = (await call<CommerceCatalog>('/catalog')).body.products[0]!;
    const admit = () =>
      call<{ task_ids: string[] }>('/competitors/discover', {
        method: 'POST',
        body: { targets: [{ kind: 'product', id: product.id }] },
      });
    const requested = (await admit()).body.task_ids;
    const sibling = (await admit()).body.task_ids;
    expect(
      (
        await call('/competitors/discoveries/run', {
          method: 'POST',
          body: { task_ids: [randomUUID()] },
        })
      ).status,
    ).toBe(404);
    const responses = await Promise.all(
      [0, 1].map(() =>
        call('/competitors/discoveries/run', {
          method: 'POST',
          body: { task_ids: requested },
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const tasks = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('id', 'in', [...requested, ...sibling])
      .execute();
    expect(tasks.find((row) => row.id === requested[0])).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      error_code: 'provider_unavailable',
    });
    expect(tasks.find((row) => row.id === sibling[0])).toMatchObject({
      status: 'queued',
      attempt_count: 0,
    });
  });
  it('queues a frozen discovery per distinct target, starts a new run on repeat, and rejects foreign targets atomically', async () => {
    await importCsv();
    const product = (await call<CommerceCatalog>('/catalog')).body.products[0]!;
    const target = { kind: 'product', id: product.id };
    const one = await call<{ task_ids: string[] }>('/competitors/discover', {
      method: 'POST',
      body: { targets: [target, target] },
    });
    const two = await call<{ task_ids: string[] }>('/competitors/discover', {
      method: 'POST',
      body: { targets: [target] },
    });
    expect(one.status).toBe(202);
    expect(one.body.task_ids[0]).toBe(one.body.task_ids[1]);
    expect(two.body.task_ids[0]).not.toBe(one.body.task_ids[0]);
    const queued = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('id', '=', one.body.task_ids[0]!)
      .executeTakeFirstOrThrow();
    expect(queued).toMatchObject({
      status: 'queued',
      workspace_id: t.workspaceId,
      payload: { target, target_context: { name: 'One, large', price: 19.25, currency: '' } },
    });
    const foreign = await fixtures.tenant();
    tenants.push(foreign);
    const foreignTarget = randomUUID();
    await db
      .insertInto('commerce_categories')
      .values({
        id: foreignTarget,
        workspace_id: foreign.workspaceId,
        project_id: foreign.projectId,
        name: 'Foreign',
        normalized_name: 'foreign',
        role: 'leaf',
        canonical_url: '',
        field_sources: {},
        source_analysis_id: null,
        projector_version: policy.commerce.projector_version,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    expect(
      (
        await call('/competitors/discover', {
          method: 'POST',
          body: { targets: [target, { kind: 'category', id: foreignTarget }] },
        })
      ).status,
    ).toBe(404);
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('project_id', '=', t.projectId)
        .where('task_kind', '=', 'commerce_competitor_discovery')
        .execute(),
    ).toHaveLength(2);
  });
  it('serializes simultaneous imports, keeps raw evidence, and publishes shared-contract values', async () => {
    const [one, two] = await Promise.all([importCsv(), importCsv()]);
    expect(one.status).toBe(200);
    expect(two).toEqual(one);
    // Staging the same content again returns the applied import and its results.
    expect((await stageCsv()).body).toMatchObject({
      import_id: one.body.import_id,
      result: { import_id: one.body.import_id, created: 1 },
    });
    const catalog = await call<CommerceCatalog>('/catalog');
    // The list is navigation: names and memberships, never the row's evidence.
    expect(catalog.body).toEqual({
      products: [
        {
          id: one.body.row_outcomes[0]!.product_id,
          canonical_url: 'https://shop.example/products/one',
          name: 'One, large',
          brand: 'Acme',
          category_ids: [catalog.body.categories[0]!.id],
        },
      ],
      product_total: 1,
      categories: [
        { id: catalog.body.categories[0]!.id, name: 'Tools', parent_id: null, product_count: 1 },
      ],
      // No brand profile confirms a business model yet.
      projection: { applicability: 'unknown', in_flight: 0, failed: 0 },
    });
    const artifacts = await db
      .selectFrom('commerce_csv_imports')
      .selectAll()
      .where('project_id', '=', t.projectId)
      .execute();
    expect(artifacts.map((row) => row.raw_payload)).toEqual([csv]);
    const observations = await db
      .selectFrom('commerce_product_observations')
      .selectAll()
      .where('project_id', '=', t.projectId)
      .execute();
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      csv_import_id: one.body.import_id,
      csv_row_number: 2,
      importer_version: policy.commerce.importer_version,
    });
    // The one import is one catalog revision, whose work is re-matching recent
    // answers and refreshing the Opportunities its catalog fields feed.
    const revisions = await db
      .selectFrom('commerce_catalog_revisions')
      .select(['id', 'revision_number', 'source_kind', 'source_id'])
      .where('workspace_id', '=', t.workspaceId)
      .where('project_id', '=', t.projectId)
      .execute();
    expect(revisions).toEqual([
      {
        id: expect.any(String),
        revision_number: 1,
        source_kind: 'import',
        source_id: one.body.import_id,
      },
    ]);
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select(['task_kind', 'payload'])
        .where('project_id', '=', t.projectId)
        .orderBy('task_kind')
        .execute(),
    ).toEqual([
      {
        task_kind: 'commerce_answer_matching',
        payload: { catalog_revision_id: revisions[0]!.id },
      },
      {
        task_kind: 'opportunity_refresh',
        payload: { trigger_kind: 'commerce_catalog_import', trigger_id: one.body.import_id },
      },
    ]);
    const update = await importCsv('sku,title,brand\nA1,Updated,Acme\n');
    expect(update.body.updated).toBe(1);
    const stored = await db
      .selectFrom('commerce_products')
      .select(['name', 'price', 'field_sources'])
      .where('project_id', '=', t.projectId)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      name: 'Updated',
      price: '19.25',
      field_sources: { name: { kind: 'csv', source_id: update.body.import_id } },
    });
  });
  it('bounds the listed products by name while counting every product and membership', async () => {
    await importCsv(
      'link,title,brand,sku,category\nhttps://shop.example/c,Cedar,Acme,C1,Wood\nhttps://shop.example/a,Ash,Acme,A1,Wood\nhttps://shop.example/b,Birch,Acme,B1,Wood\n',
    );
    const limit = policy.commerce.catalog_product_limit;
    policy.commerce.catalog_product_limit = 2;
    try {
      const { body } = await call<CommerceCatalog>('/catalog');
      const wood = body.categories[0]!.id;
      expect(body.products.map((row) => [row.name, row.category_ids])).toEqual([
        ['Ash', [wood]],
        ['Birch', [wood]],
      ]);
      expect(body.product_total).toBe(3);
      expect(body.categories.map((row) => [row.name, row.product_count])).toEqual([['Wood', 3]]);
    } finally {
      policy.commerce.catalog_product_limit = limit;
    }
  });
  it('serves the projection state alone, as the catalog reports it, inside its workspace', async () => {
    await enqueue(db, {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      kind: 'commerce_catalog_projection',
      payload: { source_analysis_id: randomUUID() },
    });
    const projection = await call('/catalog/projection');
    expect(projection).toEqual({
      status: 200,
      body: { applicability: 'unknown', in_flight: 1, failed: 0 },
    });
    expect((await call<CommerceCatalog>('/catalog')).body.projection).toEqual(projection.body);
    const otherWorkspace = await fixtures.joinedWorkspace(t.userId);
    expect((await call('/catalog/projection', { workspace: otherWorkspace })).status).toBe(404);
  });
  it('rejects invalid and conflicting rows with their reasons first, and orders categories by membership', async () => {
    const result = await importCsv(
      'link,title,brand,sku,price,category\nhttps://shop.example/a,A,Acme,A1,4,Small\nhttps://shop.example/b,B,Acme,B1,5,Large\nhttps://shop.example/c,C,Acme,C1,6,Large\nhttps://shop.example/d,Bad,Acme,D1,NaN,Large\n',
    );
    expect(result.body).toMatchObject({ created: 3, rejected: 1 });
    expect(result.body.row_outcomes[0]).toEqual({
      row_number: 5,
      status: 'rejected',
      product_id: null,
      error_code: 'invalid_row',
      detail: 'Price "NaN" is not a number with an optional currency code',
    });
    const conflict = await importCsv(
      'link,sku,title,brand\nhttps://shop.example/a,B1,Conflict,Acme\n',
    );
    expect(conflict.body).toMatchObject({
      created: 0,
      rejected: 1,
      row_outcomes: [{ row_number: 2, status: 'rejected', error_code: 'identity_conflict' }],
    });
    expect(
      (await call<CommerceCatalog>('/catalog')).body.categories.map((row) => [
        row.name,
        row.product_count,
      ]),
    ).toEqual([
      ['Large', 2],
      ['Small', 1],
    ]);
    expect(
      await db
        .selectFrom('commerce_csv_imports')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toHaveLength(2);
  });
  it('bounds bytes and rows and rejects malformed CSV and corrupt persisted JSON', async () => {
    for (const content of [
      '',
      'title,title,brand\na,b,c\n',
      'title;brand\na;b\n',
      'title,brand\n"unterminated',
    ])
      expect((await stageCsv(content)).status).toBe(422);
    expect(
      (await stageCsv('title,brand\n' + 'é'.repeat(policy.commerce.import_max_bytes / 2))).status,
    ).toBe(422);
    expect(
      (await stageCsv('title,brand\n' + 'a,b\n'.repeat(policy.commerce.import_max_rows + 1)))
        .status,
    ).toBe(422);
    // A refused file stores nothing.
    expect(
      await db
        .selectFrom('commerce_csv_imports')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toEqual([]);
    const imported = await importCsv();
    await db
      .updateTable('commerce_products')
      .set({ attributes: '[]' })
      .where('project_id', '=', t.projectId)
      .execute();
    // The catalog list never reads a row's evidence, so it stays readable; the
    // discovery context that does read the attributes refuses the corrupt row.
    expect((await call('/catalog')).status).toBe(200);
    expect(
      (
        await call('/competitors/discover', {
          method: 'POST',
          body: {
            targets: [{ kind: 'product', id: imported.body.row_outcomes[0]!.product_id }],
          },
        })
      ).status,
    ).toBe(500);
  });
});

describe('decisions and persisted reads', () => {
  it('serializes decisions and makes the catalog and approvals consumable by the audit context', async () => {
    const imported = await importCsv();
    const productId = imported.body.row_outcomes[0]!.product_id!;
    const ids = await commerceFixture<{ promptId: string; candidateId: string }>(
      'prompt',
      t.workspaceId,
      t.projectId,
      productId,
    );
    const candidates = await Promise.all(
      [true, false].map((approved) =>
        call<CompetitorCandidate>(`/competitors/${ids.candidateId}`, {
          method: 'PATCH',
          body: { decision: approved ? 'approved' : 'rejected' },
        }),
      ),
    );
    expect(candidates.map((row) => row.status)).toEqual([200, 200]);
    const prompts = await Promise.all(
      [true, false].map((approved) =>
        call<BuyerPrompt>(`/buyer-prompts/${ids.promptId}`, {
          method: 'PATCH',
          body: { approved },
        }),
      ),
    );
    expect(prompts.map((row) => row.status)).toEqual([200, 200]);
    const read = (await call<BuyerPrompt[]>('/buyer-prompts')).body[0]!;
    expect(read.enabled).toBe(read.approved_at !== null);
    await call(`/competitors/${ids.candidateId}`, {
      method: 'PATCH',
      body: { decision: 'approved' },
    });
    await call(`/buyer-prompts/${ids.promptId}`, { method: 'PATCH', body: { approved: true } });
    const context = await freezeCommerceContext(db, t, [ids.promptId]);
    expect(context.targets[0]!.products[0]).toMatchObject({ id: productId, price: 19.25 });
    expect(context.targets[0]!.approved_competitors.map((row) => row.id)).toEqual([
      ids.candidateId,
    ]);
    expect(
      await db
        .selectFrom('competitors')
        .select('id')
        .where('project_id', '=', t.projectId)
        .execute(),
    ).toEqual([]);
    expect((await call<CompetitorCandidate[]>('/competitors')).body[0]!.state).toBe('approved');
  }, 20_000);
  it('freezes a target shared by several approved prompts once', async () => {
    const productId = (await importCsv()).body.row_outcomes[0]!.product_id!;
    const first = await commerceFixture<{ promptId: string }>(
      'prompt',
      t.workspaceId,
      t.projectId,
      productId,
    );
    const { prompt_set_id: setId } = await db
      .selectFrom('prompts')
      .select('prompt_set_id')
      .where('id', '=', first.promptId)
      .executeTakeFirstOrThrow();
    const second = await prompt(db, setId, 'quiet cordless drill for apartment shelves');
    await db
      .insertInto('commerce_prompt_targets')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        prompt_id: second,
        target_kind: 'product',
        target_id: productId,
        template_version: policy.commerce.buyer_prompts.version,
        created_at: new Date(),
      })
      .execute();
    await db
      .updateTable('commerce_prompt_targets')
      .set({ approved_at: new Date() })
      .where('project_id', '=', t.projectId)
      .execute();
    const context = await freezeCommerceContext(db, t, [first.promptId, second]);
    expect(context.targets.map((row) => [row.kind, row.id])).toEqual([['product', productId]]);
    expect(context.prompt_target_ids).toHaveLength(2);
  });
  it('leaves an archived product out of the frozen prompt context instead of refusing', async () => {
    const productId = (await importCsv()).body.row_outcomes[0]!.product_id!;
    const { promptId } = await commerceFixture<{ promptId: string }>(
      'prompt',
      t.workspaceId,
      t.projectId,
      productId,
    );
    await db
      .updateTable('commerce_prompt_targets')
      .set({ approved_at: new Date() })
      .where('project_id', '=', t.projectId)
      .execute();
    const archive = await call(`/products/${productId}/lifecycle`, {
      method: 'PUT',
      body: { lifecycle_state: 'archived' },
    });
    expect(archive.status).toBe(200);
    const context = await freezeCommerceContext(db, t, [promptId]);
    expect([context.targets, context.prompt_target_ids]).toEqual([[], []]);

    await call(`/products/${productId}/lifecycle`, {
      method: 'PUT',
      body: { lifecycle_state: 'active' },
    });
    const restored = await freezeCommerceContext(db, t, [promptId]);
    expect(restored.targets.map((row) => [row.kind, row.id])).toEqual([['product', productId]]);
  });
  it('reads active and requested discovery tasks without starting discovery', async () => {
    const target = { kind: 'product', id: randomUUID() };
    const id = await enqueue(db, {
      ...t,
      kind: 'commerce_competitor_discovery',
      payload: { target },
    });
    expect(
      (await call<CompetitorDiscoveryTask[]>('/competitors/discoveries')).body.map((row) => row.id),
    ).toEqual([id]);
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'failed', error_code: 'unavailable' })
      .where('id', '=', id)
      .execute();
    expect((await call<CompetitorDiscoveryTask[]>('/competitors/discoveries')).body).toEqual([]);
    expect(
      (
        await call<CompetitorDiscoveryTask[]>(
          `/competitors/discoveries?task_ids=${id.toUpperCase()}`,
        )
      ).body[0],
    ).toMatchObject({ target, terminal: true, error_code: 'unavailable' });
    expect((await call(`/competitors/discoveries?task_ids=${randomUUID()}`)).status).toBe(404);
  });
  it("reads one product's page with its open Actions, and no page for an unknown holder", async () => {
    expect((await call(`/products/${randomUUID()}`)).status).toBe(404);
    const product = (await importCsv()).body.row_outcomes[0]!.product_id!;
    const opportunity = opportunityRow(
      { workspace_id: t.workspaceId, project_id: t.projectId },
      {
        rule_id: 'catalog_fields_missing',
        opportunity_type: 'commerce',
        severity: 'medium',
        target_key: `product:${product}`,
        title: 'Add the missing price',
      },
    );
    await db.insertInto('opportunities').values(opportunity).execute();
    const action = actionRow(
      { workspace_id: t.workspaceId, project_id: t.projectId },
      { group_key: `product:${product}`, target_kind: 'product', target_label: 'One, large' },
    );
    await db.insertInto('actions').values(action).execute();
    await db
      .updateTable('opportunities')
      .set({ action_id: action.id })
      .where('id', '=', opportunity.id)
      .execute();

    const path = `/products/${product}`;
    const measured = (await call<CommerceProductDetail>(path)).body;
    // No answer in scope: visibility is unavailable, appearances a real zero.
    expect(measured.product).toMatchObject({
      name: 'One, large',
      visibility: null,
      appearances: 0,
      win_rate: null,
      catalog_price: { min: 19.25, max: 19.25, currency: '' },
      image_url: null,
    });
    expect(measured.answers).toEqual([]);
    expect(measured.actions).toEqual([
      { id: action.id, title: 'Add the missing price', status: 'open' },
    ]);
    expect((await call(`${path}?window=14`)).status).toBe(422);

    await updateActionStatus(
      db,
      { workspaceId: t.workspaceId, projectId: null },
      action.id,
      'dismissed',
      t.userId,
    );
    expect((await call<CommerceProductDetail>(path)).body.actions).toEqual([]);
  });
});
