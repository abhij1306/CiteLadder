import { afterAll, expect, it, vi } from 'vitest';
import { buildLinkMetrics, type LinkPage } from '../src/site-health/link-graph.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { TaskQueue } from '../src/queue/task-queue.ts';
import { record } from '../src/db/json.ts';
import { testDatabase } from './support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';

const anchor = (url: string, region = 'main', rel = '', text = '') => ({
  url,
  region,
  rel,
  anchor_text: text,
  is_internal: true,
});
function page(
  id: string,
  path: string,
  anchors: unknown[] = [],
  extra: Partial<LinkPage> = {},
): LinkPage {
  const url = `https://example.test${path}`;
  return {
    id,
    url,
    finalUrl: url,
    artifactId: `artifact-${id}`,
    facts: { links: { anchors } },
    aliases: [],
    ...extra,
  };
}
function graph(pages: LinkPage[]) {
  return new Map(
    buildLinkMetrics(pages, 'https://example.test/').map((row) => [row.site_url_id, row]),
  );
}
it('collapses repeated destinations, retains off-crawl links and only follows eligible paths', () => {
  const rows = graph([
    page('home', '/', [anchor('/category', 'nav'), anchor('/category'), anchor('/outside')]),
    page('category', '/category', [anchor('/product', 'main', 'nofollow sponsored')]),
    page('product', '/product'),
  ]);
  expect(rows.get('home')!.outbound_count).toBe(2);
  expect(rows.get('category')!.top_inbound[0]!.anchor_count).toBe(2);
  expect(rows.get('category')!.depth_from_home).toBe(1);
  expect(rows.get('product')!.depth_from_home).toBeNull();
  expect(rows.get('product')!.nofollow_inbound_count).toBe(1);
});
it('exact nodes win redirect aliases and ambiguous aliases remain unobserved', () => {
  const pages = [
    page('home', '/', [anchor('/new'), anchor('/ambiguous'), anchor('/old-alias')]),
    page('old', '/old', [], {
      finalUrl: 'https://example.test/new',
      aliases: ['https://example.test/ambiguous', 'https://example.test/old-alias'],
    }),
    page('new', '/new', [], { aliases: ['https://example.test/ambiguous'] }),
  ];
  const rows = graph(pages);
  expect(rows.get('new')!.inbound_count).toBe(1);
  expect(rows.get('old')!.inbound_count).toBe(1);
  expect(
    rows.get('home')!.top_outbound.find((row) => row.url.endsWith('/ambiguous'))!.site_url_id,
  ).toBeNull();
  expect(graph([...pages].reverse()).get('home')).toEqual(rows.get('home'));
});
it('mixed follow/nofollow edges retain their individual weights and dangling authority', () => {
  const rows = graph([
    page('home', '/', [
      anchor('/main'),
      anchor('/nav', 'nav'),
      anchor('/nofollow', 'main', 'nofollow'),
      anchor('/mixed', 'nav'),
      anchor('/mixed', 'main', 'nofollow'),
    ]),
    ...['main', 'nav', 'nofollow', 'mixed', 'disconnected'].map((id) => page(id, `/${id}`)),
  ]);
  expect([...rows.values()].reduce((sum, row) => sum + row.authority_share, 0)).toBeCloseTo(1, 12);
  expect(rows.get('main')!.authority_share).toBeGreaterThan(rows.get('mixed')!.authority_share);
  expect(rows.get('mixed')!.authority_share).toBeGreaterThan(rows.get('nav')!.authority_share);
  expect(rows.get('nav')!.authority_share).toBeGreaterThan(rows.get('nofollow')!.authority_share);
  expect(rows.get('disconnected')!.authority_share).toBeGreaterThan(0);
  expect(rows.get('mixed')!.nofollow_inbound_count).toBe(1);
});
it('page nofollow prevents downstream depth and empty crawls have no fabricated metrics', () => {
  const rows = graph([
    page('home', '/', [anchor('/child')], {
      facts: { robots: { nofollow: true }, links: { anchors: [anchor('/child')] } },
    }),
    page('child', '/child'),
  ]);
  expect(rows.get('child')!.depth_from_home).toBeNull();
  expect(buildLinkMetrics([], 'https://example.test/')).toEqual([]);
});
it('groups generic and reused labels while retaining destination-specific lexical evidence', () => {
  const targetFacts = { title: 'Analytics platform', headings: { h1_texts: ['Analytics'] } };
  const row = graph([
    page('home', '/', [
      anchor('/analytics', 'main', '', 'click here'),
      anchor('/analytics', 'main', '', 'shared label'),
      anchor('/reports', 'nav', '', 'shared label'),
    ]),
    page('analytics', '/analytics', [], { facts: targetFacts }),
    page('reports', '/reports', [], { facts: targetFacts }),
  ]).get('home')!;
  expect(row.anchor_diagnostics.find((entry) => entry.kind === 'generic')!.occurrences).toBe(1);
  const reused = row.anchor_diagnostics.find((entry) => entry.kind === 'repeated_destination')!;
  expect(reused.occurrences).toBe(2);
  expect(reused.destination_count).toBe(2);
  expect(
    row.anchor_diagnostics.filter((entry) => entry.kind === 'low_lexical_alignment'),
  ).toHaveLength(3);
});
it('counts links in a hidden menu for reachability but never as main content', () => {
  const menu = (url: string) => ({ url, rel: '', is_internal: true });
  const rows = graph([
    page('home', '/', [], {
      facts: {
        links: {
          anchors: [anchor('/featured', 'main', '', 'Featured')],
          unrendered_anchors: [menu('/collections/launch-monitors'), menu('/featured')],
        },
      },
    }),
    page('featured', '/featured'),
    page('monitors', '/collections/launch-monitors', [anchor('/collections/launch-monitors/gc3')]),
    page('gc3', '/collections/launch-monitors/gc3'),
  ]);
  const monitors = rows.get('monitors')!;
  expect(monitors.inbound_count).toBe(1);
  expect(monitors.main_content_inbound_count).toBe(0);
  expect(monitors.depth_from_home).toBe(1);
  expect(rows.get('gc3')!.depth_from_home).toBe(2);
  expect(rows.get('featured')!.top_inbound[0]).toEqual({
    site_url_id: 'home',
    url: 'https://example.test/',
    anchor_count: 2,
    main_content: true,
    nofollow: false,
    rel: [],
  });
});

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
const settings = {
  ...siteWorkerSettings({}),
  concurrency: 2,
  retryBase: 0,
  retryMax: 0,
  retryJitter: 0,
  conflictBase: 0,
  conflictJitter: 0,
};
it('persists scoped current-page metrics and admits one architecture successor in the same commit', async () => {
  const seed = await fixtures.crawl();
  const other = await fixtures.crawl();
  const home = await fixtures.page(seed, '/', {
    links: { anchors: [anchor('/product'), anchor('/product', 'nav', 'nofollow')] },
  });
  const product = await fixtures.page(seed, '/product', {});
  await fixtures.page(seed, '/stale', {}, { current: false });
  await fixtures.page(seed, '/failed', {}, { status: 'failed' });
  await fixtures.page(other, '/', {});
  const id = await fixtures.task(seed);
  const worker = fixtures.worker(seed, { owner: 'metrics', settings });
  expect(await worker.runOnce()).toBe(1);
  const rows = await db
    .selectFrom('site_page_link_metrics')
    .selectAll()
    .where('crawl_id', '=', seed.crawlId)
    .execute();
  expect(rows).toHaveLength(2);
  const target = rows.find((row) => row.site_url_id === product.id)!;
  expect(target.depth_from_home).toBe(1);
  expect(target.nofollow_inbound_count).toBe(1);
  expect(new Set(target.source_artifact_ids)).toEqual(
    new Set([home.artifactId, product.artifactId]),
  );
  const successors = await db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('crawl_id', '=', seed.crawlId)
    .where('task_kind', '=', 'architecture')
    .execute();
  expect(successors).toHaveLength(1);
  expect(
    (
      await db
        .selectFrom('site_crawl_tasks')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('succeeded');
  await db.updateTable('site_crawl_tasks').set({ status: 'queued' }).where('id', '=', id).execute();
  expect(await worker.runOnce()).toBe(2);
  expect(
    await db
      .selectFrom('site_page_link_metrics')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .execute(),
  ).toHaveLength(2);
  expect(
    await db
      .selectFrom('site_page_link_metrics')
      .select('id')
      .where('crawl_id', '=', other.crawlId)
      .execute(),
  ).toHaveLength(0);
  expect(await worker.runOnce()).toBe(0);
});
it('parallel claims are disjoint and give each workspace a turn before another row', async () => {
  const first = await fixtures.crawl();
  const second = await fixtures.crawl();
  const firstIds = await Promise.all([
    fixtures.task(first, 'link_metrics', { priority: 100 }),
    fixtures.task(first, 'link_metrics', { priority: 50 }),
  ]);
  const secondId = await fixtures.task(second, 'link_metrics', { priority: 0 });
  const queue = new TaskQueue(db, { leaseTtlSeconds: 60 }, 'site_crawl_tasks');
  const batch = await queue.claim({ owner: 'fair', kinds: ['link_metrics'], limit: 2 });
  expect(new Set(batch.map((task) => task.workspace_id))).toEqual(
    new Set([first.workspaceId, second.workspaceId]),
  );
  const rest = await Promise.all([
    queue.claim({ owner: 'one', kinds: ['link_metrics'] }),
    queue.claim({ owner: 'two', kinds: ['link_metrics'] }),
  ]);
  const all = [...batch, ...rest.flat()];
  expect(new Set(all.map((task) => task.id))).toEqual(new Set([...firstIds, secondId]));
  expect(all).toHaveLength(3);
});
it('cancellation after claim prevents both evidence and successor writes', async () => {
  const seed = await fixtures.crawl();
  await fixtures.page(seed, '/', {});
  const id = await fixtures.task(seed);
  const worker = fixtures.worker(seed, { owner: 'cancel', settings });
  const task = await fixtures.claim(worker, seed, 'link_metrics', id);
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'cancelled' })
    .where('id', '=', id)
    .execute();
  await worker.execute(task);
  expect(
    await db
      .selectFrom('site_page_link_metrics')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .execute(),
  ).toHaveLength(0);
  expect(
    await db
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('crawl_id', '=', seed.crawlId)
      .where('task_kind', '=', 'architecture')
      .execute(),
  ).toHaveLength(0);
});
it('rolls back partial evidence and handoff on failure and spends one bounded attempt', async () => {
  const seed = await fixtures.crawl();
  const id = await fixtures.task(seed, 'link_metrics', { maximum: 1 });
  const worker = fixtures.worker(seed, {
    settings,
    executors: {
      link_metrics: async (trx, crawl) => {
        await trx
          .updateTable('site_crawls')
          .set({ site_facts: JSON.stringify({ must_rollback: true }) })
          .where('id', '=', crawl.id)
          .execute();
        throw new Error('recorded failure');
      },
    },
  });
  expect(await worker.runOnce()).toBe(1);
  const task = await db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(task.status).toBe('failed');
  expect(task.attempt_count).toBe(1);
  const crawl = await db
    .selectFrom('site_crawls')
    .selectAll()
    .where('id', '=', seed.crawlId)
    .executeTakeFirstOrThrow();
  expect(record(crawl.site_facts)).toEqual({});
});
it('lets the heartbeat extend the lease while an executor holds the task fence', async () => {
  const seed = await fixtures.crawl();
  const id = await fixtures.task(seed);
  let beat: unknown;
  const worker: SiteHealthWorker = fixtures.worker(seed, {
    owner: 'beat',
    settings,
    executors: {
      link_metrics: async () => {
        const blocked = new Promise((resolve) => {
          setTimeout(() => resolve('blocked'), 2000);
        });
        beat = await Promise.race([worker.queue.heartbeat(id, 'beat', seed.workspaceId), blocked]);
      },
    },
  });
  expect(await worker.runOnce()).toBe(1);
  expect(beat).toBe(true);
  const task = await db
    .selectFrom('site_crawl_tasks')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(task.status).toBe('succeeded');
});
it('requeues database contention without spending a page attempt and fences expired heartbeats', async () => {
  const seed = await fixtures.crawl();
  const id = await fixtures.task(seed);
  const execute = vi.fn(async () => {
    throw Object.assign(new Error('recorded lock conflict'), { code: '40P01' });
  });
  const worker = fixtures.worker(seed, { settings, executors: { link_metrics: execute } });
  expect(await worker.runOnce()).toBe(1);
  const task = await db
    .selectFrom('site_crawl_tasks')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(task.status).toBe('retry_wait');
  expect(task.attempt_count).toBe(0);
  expect(task.conflict_count).toBe(1);
  await db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'running',
      lease_owner: 'expired',
      lease_expires_at: new Date(Date.now() - 1000),
    })
    .where('id', '=', id)
    .execute();
  expect(await worker.queue.heartbeat(id, 'expired', seed.workspaceId)).toBe(false);
});
