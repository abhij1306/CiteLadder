import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { recordingMeter } from './meter-fixtures.ts';
import { competitorDiscovery, enqueueDiscoveries } from '../src/commerce/discovery.ts';
import { competitorSearch, type CompetitorSearch } from '../src/commerce/discovery-provider.ts';
import { discoveryQuery } from '../src/commerce/discovery-validation.ts';
import { loadWorkerSettings, policy } from '../src/config.ts';
import { importCatalog } from '../src/commerce/import.ts';
import type { WebsiteFetcher } from '../src/projects/safe-fetch.ts';
import { AnalyticsWorker, EXECUTORS } from '../src/workers/analytics-worker.ts';
import { TaskQueue } from '../src/queue/task-queue.ts';
import { recoverAnalyticsLeases } from '../src/queue/analytics-recovery.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  settings = loadWorkerSettings({});
let t: Tenant, target: { kind: 'product'; id: string };
const tenants: Tenant[] = [];
beforeEach(async () => {
  for (const tenant of tenants)
    await db.deleteFrom('analytics_tasks').where('workspace_id', '=', tenant.workspaceId).execute();
  t = await fixtures.tenant();
  tenants.push(t);
  await db
    .updateTable('projects')
    .set({ website_url: 'https://owned.example/' })
    .where('id', '=', t.projectId)
    .execute();
  await importCatalog(db, scope(), {
    content: 'canonical_url,name,price\nhttps://owned.example/products/tool,Kitchen tool,40\n',
    filename: 'test.csv',
    content_type: 'text/csv',
  });
  const product = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('project_id', '=', t.projectId)
    .executeTakeFirstOrThrow();
  target = { kind: 'product', id: product.id };
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
const scope = () => ({ workspaceId: t.workspaceId, projectId: t.projectId });
const attempts = () =>
  db
    .selectFrom('commerce_competitor_attempts')
    .selectAll()
    .where('workspace_id', '=', t.workspaceId)
    .orderBy('attempt_number')
    .execute();
const candidates = () =>
  db
    .selectFrom('commerce_competitor_candidates')
    .selectAll()
    .where('workspace_id', '=', t.workspaceId)
    .execute();
const queueTask = (id: string) =>
  db.selectFrom('analytics_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const enqueue = async () =>
  (await enqueueDiscoveries(db, scope(), { targets: [target] })).task_ids[0]!;
const worker = (search: CompetitorSearch, fetcher?: WebsiteFetcher) =>
  new AnalyticsWorker(db, settings, {
    owner: 'discovery-test',
    executors: { commerce_competitor_discovery: competitorDiscovery({ search, fetcher }) },
  });
const productHtml = `<html><head><title>Merchant tool</title></head><body><main><h1>Merchant tool</h1><p>$40.00</p><button>Add to cart</button><script type="application/ld+json">{"@type":"Product","name":"Merchant tool","sku":"T1","offers":{"@type":"Offer","price":"40","priceCurrency":"USD"}}</script></main></body></html>`;
const fetcher: WebsiteFetcher = async (url) => ({
  url,
  status: 200,
  contentType: url.endsWith('/robots.txt') ? 'text/plain' : 'text/html',
  body: Buffer.from(url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /\n' : productHtml),
});
const { meter } = recordingMeter();
const successful: CompetitorSearch = async () => ({
  status: 'succeeded',
  errorCode: '',
  retry: false,
  results: [
    {
      url: 'https://merchant.example/products/tool',
      title: 'Merchant tool',
      content: 'Search evidence',
    },
  ],
});

it('bounds daily competitor discovery targets per workspace before queueing work', async () => {
  vi.stubEnv('ABUSE_COMMERCE_DISCOVERIES_PER_WORKSPACE_DAILY', '2');
  try {
    // A repeated target is one discovery and spends one unit of the window.
    await enqueueDiscoveries(db, scope(), { targets: [target, target] });
    await enqueue();
    await expect(enqueueDiscoveries(db, scope(), { targets: [target] })).rejects.toMatchObject({
      status: 429,
    });
    const queued = await db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', 'commerce_competitor_discovery')
      .execute();
    expect(queued).toHaveLength(2);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('validates real page facts, preserves every verdict and source attempt, and never overrides approval', async () => {
  const search: CompetitorSearch = async () => ({
    ...(await successful('', '', meter)),
    results: [
      { url: 'https://owned.example/products/tool', title: 'Owned', content: '' },
      { url: 'https://amazon.com/products/tool', title: 'Marketplace', content: '' },
      { url: 'https://publisher.example/tool', title: '5 best tools', content: '' },
      {
        url: 'https://merchant.example/products/tool?utm_source=test',
        title: 'Merchant tool',
        content: 'Search evidence',
        source_id: 'source-merchant',
        processing_version: 'search-processing-2',
        provider: 'keenable',
      },
      { url: 'https://merchant.example/products/tool', title: 'Duplicate', content: '' },
      { url: 'https://broken.example/products/tool', title: 'Broken', content: '' },
    ],
  });
  const pages: string[] = [];
  const acquire: WebsiteFetcher = async (url, options) => {
    pages.push(url);
    if (url.includes('broken.')) throw new Error('Unavailable');
    return fetcher(url, options);
  };
  const id = await enqueue();
  await worker(search, acquire).runOnce();
  expect(await queueTask(id)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
  const [attempt] = await attempts();
  expect(attempt!.result_payload).toMatchObject([
    { validation_outcome: 'excluded_owned_domain' },
    { validation_outcome: 'excluded_marketplace' },
    { validation_outcome: 'excluded_editorial' },
    {
      validation_outcome: 'accepted',
      source_id: 'source-merchant',
      processing_version: 'search-processing-2',
    },
    { validation_outcome: 'excluded_duplicate' },
    { validation_outcome: 'excluded_unavailable' },
  ]);
  const [candidate] = await candidates();
  expect(candidate).toMatchObject({
    attempt_id: attempt!.id,
    state: 'pending',
    canonical_url: 'https://merchant.example/products/tool',
    evidence: {
      search_excerpt: 'Search evidence',
      source_id: 'source-merchant',
      processing_version: 'search-processing-2',
      extractor_version: policy.site_health.versions.extractor,
    },
  });
  expect(pages.some((url) => /owned\.|amazon\.|publisher\./u.test(url))).toBe(false);
  await db
    .updateTable('commerce_competitor_candidates')
    .set({ state: 'approved', decision_at: new Date() })
    .where('id', '=', candidate!.id)
    .execute();
  await enqueue();
  await worker(successful, fetcher).runOnce();
  expect(await candidates()).toHaveLength(1);
  expect((await candidates())[0]).toMatchObject({ state: 'approved', attempt_id: attempt!.id });
  expect(await attempts()).toHaveLength(2);
});

it('distinguishes unavailable providers from transient failures and retries without rewriting attempts', async () => {
  const id = await enqueue();
  const unavailable = competitorSearch({});
  await worker(unavailable).runOnce();
  expect(await queueTask(id)).toMatchObject({
    status: 'failed',
    error_code: 'provider_unavailable',
    attempt_count: 1,
  });
  expect((await attempts())[0]).toMatchObject({
    status: 'unavailable',
    error_code: 'provider_unavailable',
  });
  const retry = await enqueue();
  await worker(async () => ({
    status: 'failed',
    errorCode: 'provider_failed',
    retry: true,
    results: [],
  })).runOnce();
  expect(await queueTask(retry)).toMatchObject({ status: 'retry_wait', attempt_count: 1 });
  await db
    .updateTable('analytics_tasks')
    .set({ available_at: new Date(0) })
    .where('id', '=', retry)
    .execute();
  await worker(successful, fetcher).runOnce();
  expect(await queueTask(retry)).toMatchObject({ status: 'succeeded', attempt_count: 2 });
  const retryAttempts = (await attempts()).filter((row) => row.task_id === retry);
  expect(retryAttempts.map((row) => [row.attempt_number, row.status])).toEqual([
    [1, 'failed'],
    [2, 'succeeded'],
  ]);
});

it('counts only verified survivors against accept slots and preserves the over-limit verdict', async () => {
  const search: CompetitorSearch = async () => ({
    ...(await successful('', '', meter)),
    results: [
      { url: 'https://broken.example/products/tool', title: 'Unavailable tool', content: '' },
      ...Array.from({ length: policy.commerce.discovery.result_limit + 1 }, (_, index) => ({
        url: `https://merchant-${index}.example/products/tool`,
        title: 'Merchant tool',
        content: '',
      })),
    ],
  });
  await enqueue();
  await worker(search, async (url, options) => {
    if (url.includes('broken.')) throw new Error('Unavailable');
    return fetcher(url, options);
  }).runOnce();
  expect((await attempts())[0]!.result_payload).toMatchObject([
    { validation_outcome: 'excluded_unavailable' },
    ...Array.from({ length: policy.commerce.discovery.result_limit }, () => ({
      validation_outcome: 'accepted',
    })),
    { validation_outcome: 'excluded_limit' },
  ]);
  expect(await candidates()).toHaveLength(policy.commerce.discovery.result_limit);
});

it.each(['before-search', 'during-search'])(
  'terminalizes a removed target %s without publishing or spending retries',
  async (phase) => {
    const id = await enqueue();
    const remove = () => db.deleteFrom('commerce_products').where('id', '=', target.id).execute();
    if (phase === 'before-search') await remove();
    let calls = 0;
    await worker(async (...args) => {
      calls++;
      await remove();
      return successful(...args);
    }, fetcher).runOnce();
    expect(await queueTask(id)).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      error_code: policy.commerce.discovery.target_missing_error,
    });
    expect(calls).toBe(phase === 'before-search' ? 0 : 1);
    expect(await attempts()).toEqual([]);
    expect(await candidates()).toEqual([]);
  },
);

it('refuses an oversized valid Tavily envelope before parsing candidates', async () => {
  const search = competitorSearch({ TAVILY_API_KEY: 'fixture' }, async () =>
    Response.json({
      results: [],
      padding: 'x'.repeat(policy.commerce.discovery.response_max_bytes),
    }),
  );
  expect(await search('Tool', '', meter)).toMatchObject({
    status: 'unavailable',
    retry: true,
    results: [],
  });
});

it('preserves a completed evidence settlement when the interactive deadline expires', async () => {
  const id = await enqueue();
  const sibling = await enqueue();
  const controller = new AbortController();
  const discovery = competitorDiscovery({ search: successful, fetcher });
  const interactive = new AnalyticsWorker(db, settings, {
    taskScope: { workspaceId: t.workspaceId, taskIds: [id] },
    signal: controller.signal,
    executors: {
      commerce_competitor_discovery: async (task, context) => {
        const settlement = await discovery(task, context);
        controller.abort();
        return settlement;
      },
    },
  });
  await interactive.runOnce();
  expect(await queueTask(id)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
  expect(await attempts()).toHaveLength(1);
  expect(await candidates()).toHaveLength(1);
  expect(await interactive.runOnce()).toBe(0);
  expect(await queueTask(sibling)).toMatchObject({ status: 'queued', attempt_count: 0 });
});

it('refuses unusable names before provider I/O and fences foreign targets', async () => {
  await db
    .updateTable('commerce_products')
    .set({ name: 'Tool | marketing title' })
    .where('id', '=', target.id)
    .execute();
  const id = await enqueue();
  let called = false;
  await worker(async (...args) => {
    called = true;
    return successful(...args);
  }).runOnce();
  expect(await queueTask(id)).toMatchObject({ status: 'failed', error_code: 'unusable_target' });
  expect(called).toBe(false);
  await db
    .updateTable('analytics_tasks')
    .set({
      status: 'queued',
      payload: JSON.stringify({
        target: { ...target, id: randomUUID() },
        target_context: { name: 'Tool' },
      }),
    })
    .where('id', '=', id)
    .execute();
  await worker(async (...args) => {
    called = true;
    return successful(...args);
  }).runOnce();
  expect(called).toBe(false);
  expect(await attempts()).toEqual([]);
});

it('discards publication after cancellation or reclaim even if the same owner is reused', async () => {
  for (const mode of ['cancel', 'reclaim'] as const) {
    const id = await enqueue();
    const search: CompetitorSearch = async () => {
      if (mode === 'cancel')
        await db
          .updateTable('analytics_tasks')
          .set({ status: 'cancelled' })
          .where('id', '=', id)
          .execute();
      else {
        await db
          .updateTable('analytics_tasks')
          .set({ lease_expires_at: new Date(0) })
          .where('id', '=', id)
          .execute();
        expect(await recoverAnalyticsLeases(db, 10)).toBe(1);
        const queue = new TaskQueue(db, {
          leaseTtlSeconds: 120,
          now: () => new Date(Date.now() + 1000),
        });
        expect(
          await queue.claim({ owner: 'discovery-test', kinds: ['commerce_competitor_discovery'] }),
        ).toHaveLength(1);
        expect(await queue.markRunning(id, 'discovery-test', 0)).toBe(false);
        expect(await queue.markRunning(id, 'discovery-test', 1)).toBe(true);
        expect(await queue.heartbeat(id, 'discovery-test', t.workspaceId, 0)).toBe(false);
      }
      return successful('', '', meter);
    };
    await worker(search, fetcher).runOnce();
    expect(await queueTask(id)).toMatchObject({
      status: mode === 'cancel' ? 'cancelled' : 'running',
      attempt_count: mode === 'cancel' ? 0 : 1,
    });
    expect(await attempts()).toEqual([]);
    expect(await candidates()).toEqual([]);
  }
});

it('recovers exhausted tasks in bounded batches, preserves errors, and drains an empty queue', async () => {
  const one = await enqueue(),
    two = await enqueue();
  await db
    .updateTable('analytics_tasks')
    .set({
      status: 'running',
      lease_owner: 'dead',
      lease_expires_at: new Date(0),
      attempt_count: 2,
    })
    .where('id', 'in', [one, two])
    .execute();
  await db
    .updateTable('analytics_tasks')
    .set({ error_code: 'prior_error', error_detail: 'Prior failure' })
    .where('id', '=', two)
    .execute();
  expect(await recoverAnalyticsLeases(db, 1)).toBe(1);
  expect(await worker(successful).runUntilIdle()).toBe(0);
  expect(await queueTask(one)).toMatchObject({
    status: 'failed',
    attempt_count: 3,
    error_code: policy.task_queue.max_attempts_error,
    lease_owner: null,
  });
  expect(await queueTask(two)).toMatchObject({
    status: 'failed',
    attempt_count: 3,
    error_code: 'prior_error',
    error_detail: 'Prior failure',
  });
  expect(Object.keys(EXECUTORS).sort()).toEqual([...policy.analytics.task_kinds].sort());
});

it('requires target-compatible structural evidence rather than schema claims alone', async () => {
  const category = randomUUID();
  await db
    .insertInto('commerce_categories')
    .values({
      id: category,
      ...{ workspace_id: t.workspaceId, project_id: t.projectId },
      name: 'Tools',
      normalized_name: 'tools',
      role: 'leaf',
      canonical_url: '',
      field_sources: {},
      source_analysis_id: null,
      projector_version: policy.commerce.projector_version,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  await enqueueDiscoveries(db, scope(), { targets: [{ kind: 'category', id: category }] });
  await worker(successful, fetcher).runOnce();
  expect(await candidates()).toEqual([]);
  const id = await enqueue();
  await worker(successful, async (url, options) => ({
    ...(await fetcher(url, options)),
    url: 'https://merchant.example/guide',
    body: Buffer.from(
      '<html><head><title>Editorial</title></head><body><main><article>Editorial content<script type="application/ld+json">{"@type":"Product","name":"Claim"}</script></article></main></body></html>',
    ),
  })).runOnce();
  expect(await queueTask(id)).toMatchObject({ status: 'succeeded' });
  expect(await candidates()).toEqual([]);
});

it('uses bounded product qualifiers and separate category merchant intent', () => {
  expect(
    discoveryQuery(target, {
      name: 'tool',
      attributes: { type: 'thermometer', wireless: 'Bluetooth', availability: 'In stock' },
      price: 40,
      currency: 'USD',
    }),
  ).toBe('buy tool thermometer Bluetooth price USD 25 to 75 online store');
  expect(discoveryQuery({ ...target, kind: 'category' }, { name: 'Tools', price: 40 })).toBe(
    'buy Tools online store',
  );
});

it('falls back from failed Tavily to the existing Keenable transport and refuses credential redirects', async () => {
  const sent: { url: string; init?: RequestInit }[] = [];
  const search = competitorSearch(
    { TAVILY_API_KEY: 'test-tavily', KEENABLE_API_KEY: 'test-keenable' },
    async (input, init) => {
      sent.push({ url: String(input), init });
      return String(input).includes('tavily')
        ? new Response('', { status: 503 })
        : Response.json({
            results: [
              {
                source_id: 'provider-source-123',
                url: 'https://merchant.example/products/tool',
                title: 'Tool',
                snippet: 'Evidence',
              },
            ],
          });
    },
  );
  expect(await search('buy tool online store', 'en-US', meter)).toMatchObject({
    status: 'succeeded',
    providerVersion: policy.discovery.constants.keenable_research_version,
    results: [
      {
        content: 'Evidence',
        source_id: 'provider-source-123',
        processing_version: policy.discovery.constants.keenable_research_version,
        provider: 'keenable',
      },
    ],
  });
  expect(sent.map((row) => [row.url, row.init?.redirect])).toEqual([
    ['https://api.tavily.com/search', 'error'],
    ['https://api.keenable.ai/v1/search', 'error'],
  ]);
  expect(JSON.parse(String(sent[0]!.init!.body))).toMatchObject({
    query: 'buy tool online store en-US',
    max_results: policy.commerce.discovery.provider_result_limit,
  });
  let called = false;
  expect(() =>
    competitorSearch(
      { TAVILY_API_KEY: 'test-key', TAVILY_ENDPOINT: 'https://attacker.example/search' },
      async () => {
        called = true;
        return Response.json({ results: [] });
      },
    ),
  ).toThrow(/TAVILY_ENDPOINT/u);
  expect(called).toBe(false);
});
