import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  siteCrawlListPageSchema,
  siteCrawlSchema,
  rerunPageResponseSchema,
} from '@citeladder/contracts/site-health';
import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { cancelCrawl } from '../src/site-health/controls.ts';
import { createCrawl } from '../src/site-health/planner.ts';
import { controls } from '../src/site-health/planner-policy.ts';
import { rerunPage } from '../src/site-health/selection.ts';
import { fitTrackedSet } from '../src/site-health/admission-writes.ts';
import { candidate } from '../src/site-health/frontier.ts';
import { fillTrackedSet } from '../src/site-health/tracked-set.ts';
import { classifyUrlAdmission } from '../src/site-health/url-admission.ts';
import { publishCancelledCrawls } from '../src/site-health/lifecycle.ts';
import { record } from '../src/db/json.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function request(tenant: Tenant, path: string, method = 'GET', body?: unknown, server = app) {
  return server.request(`/api/v1${path}`, {
    method,
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
/** The operator's workspace-wide monitored-URL limit. */
function allow(limit: number) {
  vi.stubEnv('SITE_HEALTH_MONITORED_URL_LIMIT', String(limit));
}
async function create(tenant: Tenant, options: Record<string, unknown> = {}) {
  return db
    .transaction()
    .execute((trx) =>
      createCrawl(trx, tenant.workspaceId, { project_id: tenant.projectId, ...options }),
    );
}

describe('crawl control admission', () => {
  it('serializes two concurrent creates and seeds one setup and the tracked root’s analysis', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow(2);
    const outcomes = await Promise.allSettled([create(tenant), create(tenant)]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = outcomes.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
      status: 409,
      code: 'crawl_already_active',
    });
    const crawl = await db
      .selectFrom('site_crawls')
      .selectAll()
      .where('project_id', '=', tenant.projectId)
      .executeTakeFirstOrThrow();
    const tasks = await db
      .selectFrom('site_crawl_tasks')
      .selectAll()
      .where('crawl_id', '=', crawl.id)
      .execute();
    // A full crawl fetches no page to discover: site setup reads the sitemap first.
    expect(tasks.map((task) => [task.task_kind, task.requested_url]).sort()).toEqual([
      ['analyze', 'https://example.test/'],
      ['site_setup', 'https://example.test/'],
    ]);
    expect(crawl.discovery_status).toBe('pending');
    expect(record(crawl.configuration)).toMatchObject({
      monitored_url_limit: 2,
      automatic_monitor_limit: 2,
      requested_page_limit: 2,
      page_profile_rule_version: policy.site_health.versions.rules,
    });
    const tracked = await db
      .selectFrom('monitored_site_urls as m')
      .innerJoin('site_urls as u', 'u.id', 'm.site_url_id')
      .select(['u.normalized_url', 'm.fill_order', 'm.active'])
      .where('m.project_id', '=', tenant.projectId)
      .execute();
    expect(tracked).toEqual([
      { normalized_url: 'https://example.test/', fill_order: 0, active: true },
    ]);
  });

  it.each([
    { input_mode: 'exact_urls', seed_urls: ['https://example.test/a'] },
    { include_globs: ['*/docs/*'] },
    { exclude_globs: ['*/private/*'] },
    { page_kinds: ['article'] },
    { requested_page_limit: 3 },
    { discovery_count: 3 },
  ])('refuses the retired crawl option %j and starts no crawl', async (option) => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    const response = await request(tenant, '/site-crawls', 'POST', {
      project_id: tenant.projectId,
      ...option,
    });
    expect(response.status).toBe(422);
    expect(
      await db
        .selectFrom('site_crawls')
        .select('id')
        .where('project_id', '=', tenant.projectId)
        .execute(),
    ).toHaveLength(0);
  });

  it('fills tracked pages in tier order, never re-picks one, and fits the set to the monitored-URL limit', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow(3);
    const crawl = await create(tenant);
    const fill = (paths: string[]) =>
      db.transaction().execute(async (trx) => {
        const items = paths.map((path) => {
          const admission = classifyUrlAdmission(`https://example.test${path}`);
          return candidate(admission, {
            url: admission.url!,
            hash: admission.hash,
            depth: 1,
            sourceKind: 'sitemap',
            parentPosition: 0,
            linkOrdinal: 0,
          });
        });
        return (await fillTrackedSet(trx, crawl, items)).map(({ item }) => item.url);
      });
    const fit = (limit: number) =>
      fitTrackedSet(db, { workspaceId: tenant.workspaceId, projectId: tenant.projectId }, limit, {
        releaseSample: true,
      });
    const tracked = async () =>
      (
        await db
          .selectFrom('monitored_site_urls as m')
          .innerJoin('site_urls as u', 'u.id', 'm.site_url_id')
          .select(['u.normalized_url', 'm.fill_order', 'm.active', 'm.deselected_at'])
          .where('m.project_id', '=', tenant.projectId)
          .orderBy('m.fill_order')
          .execute()
      ).map((row) => [
        row.normalized_url.slice('https://example.test'.length),
        row.fill_order,
        row.active,
        row.deselected_at !== null,
      ]);

    // Room for two beside the root: the product tier before about, about before the blog.
    expect(await fill(['/blog/x', '/about', '/products/a'])).toEqual([
      'https://example.test/products/a',
      'https://example.test/about',
    ]);
    // A limit of two keeps the first two in fill order; the rest leave, never resolved.
    await fit(2);
    expect(await tracked()).toEqual([
      ['/', 0, true, false],
      ['/products/a', 1, true, false],
      ['/about', 2, false, true],
    ]);
    // A free slot fills with a page never tracked before, never the page that left.
    expect(await fill(['/about', '/blog/x'])).toEqual(['https://example.test/blog/x']);
    // A higher limit restores the set in fill order first.
    await fit(3);
    expect(await tracked()).toEqual([
      ['/', 0, true, false],
      ['/products/a', 1, true, false],
      ['/about', 2, true, false],
      ['/blog/x', 3, false, true],
    ]);
  });

  it('sizes a full crawl to its tracked pages and its HTML walk to the discovery cap', async () => {
    vi.stubEnv('SITE_HEALTH_AUTOMATIC_PAGE_LIMIT', '7');
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow(50);
    const crawl = await create(tenant);
    // 50 tracked pages; the walk may discover at least that many.
    expect(record(crawl.configuration).requested_page_limit).toBe(50);
    expect(crawl.discovery_requested_count).toBe(50);
  });

  it('re-seeds only active monitored URLs and freezes full inventory lineage across a sample crawl', async () => {
    const seed = await fixtures.crawl();
    allow(3);
    const a = await fixtures.page(seed, '/a', {});
    const b = await fixtures.page(seed, '/b', {});
    const c = await fixtures.page(seed, '/c', {});
    await fixtures.monitor(seed, [a.id, b.id, c.id]);
    await fixtures.monitor(seed, [a.id, c.id]);
    const full = await create(seed);
    const tasks = await db
      .selectFrom('site_crawl_tasks')
      .select(['site_url_id', 'task_kind'])
      .where('crawl_id', '=', full.id)
      .execute();
    const root = await db
      .selectFrom('site_urls')
      .select('id')
      .where('project_id', '=', seed.projectId)
      .where('normalized_url', '=', seed.root)
      .executeTakeFirstOrThrow();
    expect(
      tasks
        .filter((task) => task.task_kind === 'analyze')
        .map((task) => task.site_url_id)
        .sort(),
    ).toEqual([a.id, c.id, root.id].sort());
    expect(
      (
        await db
          .selectFrom('site_url_observations')
          .select('site_url_id')
          .where('crawl_id', '=', full.id)
          .execute()
      )
        .map((row) => row.site_url_id)
        .sort(),
    ).toEqual([a.id, c.id, root.id].sort());
    expect(record(full.configuration).inventory_source_crawl_ids).toEqual([seed.crawlId]);
    await cancelCrawl(db, seed.workspaceId, full.id);
    await fixtures.sibling(seed, { sample_mode: true, created_at: new Date(Date.now() + 1000) });
    const next = await create(seed);
    expect(record(next.configuration).inventory_source_crawl_ids).toEqual([full.id, seed.crawlId]);
  });

  it('analyzes a monitored set that exactly fills the page limit, the root counted once', async () => {
    const seed = await fixtures.crawl();
    allow(3);
    const root = await fixtures.page(seed, '/', {});
    const a = await fixtures.page(seed, '/a', {});
    const z = await fixtures.page(seed, '/z', {});
    await fixtures.monitor(seed, [root.id, a.id, z.id]);
    const crawl = await create(seed);
    expect(record(crawl.configuration).requested_page_limit).toBe(3);
    const analyzed = await db
      .selectFrom('site_crawl_tasks')
      .select('site_url_id')
      .where('crawl_id', '=', crawl.id)
      .where('task_kind', '=', 'analyze')
      .execute();
    // Site setup is no page, so the last tracked page keeps its slot.
    expect(analyzed.map((task) => task.site_url_id).sort()).toEqual([root.id, a.id, z.id].sort());
  });

  it('refuses a page re-audit while a crawl runs and adds no work to that crawl (SH-B4)', async () => {
    const seed = await fixtures.crawl('running');
    allow(2);
    const page = await fixtures.page(seed, '/a', {}, { observed: true });
    await fixtures.monitor(seed, [page.id]);
    const tasks = () =>
      db
        .selectFrom('site_crawl_tasks')
        .select('id')
        .where('crawl_id', '=', seed.crawlId)
        .execute()
        .then((rows) => rows.length);
    const before = await tasks();
    const response = await request(
      seed,
      `/site-crawls/${seed.crawlId}/pages/${page.id}/rerun`,
      'POST',
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'crawl_already_active' } });
    expect(await tasks()).toBe(before);
    expect(
      await db
        .selectFrom('site_crawls')
        .select('id')
        .where('project_id', '=', seed.projectId)
        .execute(),
    ).toEqual([{ id: seed.crawlId }]);
  });
});

describe('crawl-control HTTP contracts', () => {
  it('preserves coded crawl errors and sanitizes invalid query identifiers', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: '' });
    const root = await request(tenant, '/site-crawls', 'POST', { project_id: tenant.projectId });
    expect(root.status).toBe(422);
    const body = record(await root.json());
    expect(body).toMatchObject({
      error: { code: 'invalid_root', retryable: false },
    });
    const invalid = await request(tenant, '/site-crawls?project_id=not-a-uuid');
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      error: { code: 'validation_error', retryable: false },
    });
  });

  it('authorizes every foreign project/crawl/page before exposing evidence or writing', async () => {
    const owner = await fixtures.crawl();
    const foreign = await fixtures.crawl();
    const page = await fixtures.page(foreign, '/private', {});
    const calls: [string, string, unknown?][] = [
      ['/site-crawls', 'POST', { project_id: foreign.projectId }],
      [`/site-crawls?project_id=${foreign.projectId}`, 'GET'],
      [`/site-crawls/${foreign.crawlId}/cancel`, 'POST'],
      [`/projects/${foreign.projectId}/monitored-urls`, 'GET'],
      [`/site-crawls/${foreign.crawlId}/pages/${page.id}/rerun`, 'POST'],
    ];
    for (const [path, method, body] of calls)
      expect((await request(owner, path, method, body)).status, path).toBe(404);
  });

  it('uses read, write and run capabilities and spends failed create attempts on the abuse limit', async () => {
    const seed = await fixtures.crawl();
    const viewer = await fixtures.user();
    await fixtures.member(seed.workspaceId, viewer, 'viewer');
    const reader = { ...seed, userId: viewer };
    expect((await request(reader, `/projects/${seed.projectId}/monitored-urls`)).status).toBe(200);
    expect(
      (await request(reader, '/site-crawls', 'POST', { project_id: seed.projectId })).status,
    ).toBe(403);
    expect((await request(reader, `/site-crawls/${seed.crawlId}/cancel`, 'POST')).status).toBe(403);
    // Settings resolve once at startup, so the lower limit is a separately started app.
    const limited = createApp(testConfig({ ABUSE_CRAWL_CREATE_LIMIT: '1' }), db);
    const create = (projectId: string) =>
      request(seed, '/site-crawls', 'POST', { project_id: projectId }, limited);
    expect((await create(randomUUID())).status).toBe(404);
    expect((await create(seed.projectId)).status).toBe(429);
  });

  it('lists by descending keyset with workspace/project/cursor isolation and count redaction', async () => {
    const seed = await fixtures.crawl();
    const next = await fixtures.sibling(seed, {
      sample_mode: true,
      configuration: JSON.stringify({ count_disclosure: false }),
      discovered_url_count: 99,
      created_at: new Date(Date.now() + 1000),
    });
    const first = siteCrawlListPageSchema.parse(
      await (await request(seed, `/site-crawls?project_id=${seed.projectId}&limit=1`)).json(),
    );
    expect(first.items[0]).toMatchObject({
      id: next,
      discovered_count: null,
      total_url_count: null,
    });
    const second = siteCrawlListPageSchema.parse(
      await (
        await request(
          seed,
          `/site-crawls?project_id=${seed.projectId}&limit=1&cursor=${first.next_cursor}`,
        )
      ).json(),
    );
    expect(second.items.map((crawl) => crawl.id)).toEqual([seed.crawlId]);
    expect((await request(seed, `/site-crawls?cursor=${first.next_cursor}`)).status).toBe(400);
    expect((await request(seed, '/site-crawls?cursor=garbage')).status).toBe(400);
  });

  it('reruns a terminal monitored page as one fresh analysis, then refuses while that rerun runs', async () => {
    const seed = await fixtures.crawl();
    allow(1);
    const page = await fixtures.page(seed, '/a', {}, { observed: true });
    await fixtures.monitor(seed, [page.id]);
    // The frozen profile, rather than a later invalid website setting, owns a rerun.
    await db
      .updateTable('projects')
      .set({ website_url: '' })
      .where('id', '=', seed.projectId)
      .execute();
    const path = `/site-crawls/${seed.crawlId}/pages/${page.id}/rerun`;
    const firstResponse = await request(seed, path, 'POST');
    expect(firstResponse.status, await firstResponse.clone().text()).toBe(202);
    const first = rerunPageResponseSchema.parse(await firstResponse.json());
    expect(first.crawl_id).not.toBe(seed.crawlId);
    const admitted = await db
      .selectFrom('site_crawls')
      .select('configuration')
      .where('id', '=', first.crawl_id)
      .executeTakeFirstOrThrow();
    expect(record(admitted.configuration).requested_page_limit).toBe(1);
    const tasks = await db
      .selectFrom('site_crawl_tasks')
      .selectAll()
      .where('crawl_id', '=', first.crawl_id)
      .execute();
    expect(tasks.map((task) => task.task_kind)).toEqual(['analyze']);
    const second = await request(seed, path, 'POST');
    expect(second.status).toBe(409);
    expect(
      await db
        .selectFrom('site_crawl_tasks')
        .select('id')
        .where('crawl_id', '=', first.crawl_id)
        .execute(),
    ).toEqual([{ id: first.task_id }]);
    expect(
      (await request(seed, `/site-crawls/${seed.crawlId}/pages/${randomUUID()}/rerun`, 'POST'))
        .status,
    ).toBe(404);
  });

  it('keeps Stop short and lets the worker publish retained analysis evidence exactly once', async () => {
    const seed = await fixtures.crawl('running');
    allow(1);
    const page = await fixtures.page(seed, '/a', {});
    await fixtures.monitor(seed, [page.id]);
    const response = await request(seed, `/site-crawls/${seed.crawlId}/cancel`, 'POST');
    expect(response.status).toBe(200);
    expect(siteCrawlSchema.parse(await response.json()).status).toBe('cancelled');
    expect(
      await db
        .selectFrom('site_health_snapshots')
        .select('id')
        .where('crawl_id', '=', seed.crawlId)
        .execute(),
    ).toHaveLength(0);
    await publishCancelledCrawls(db, 100);
    await publishCancelledCrawls(db, 100);
    expect(
      await db
        .selectFrom('site_health_snapshots')
        .select('id')
        .where('crawl_id', '=', seed.crawlId)
        .execute(),
    ).toHaveLength(1);
    expect(
      await db
        .selectFrom('site_crawl_events')
        .select('id')
        .where('crawl_id', '=', seed.crawlId)
        .where('event_type', '=', 'crawl.cancelled')
        .execute(),
    ).toHaveLength(1);
  });

  it('persists a stopped crawl’s counters with the stop and reads them, not its tasks, afterwards', async () => {
    const seed = await fixtures.crawl('running');
    await fixtures.page(seed, '/a', {});
    const counters = async (tenant: Tenant = seed) => {
      const response = await request(tenant, `/projects/${seed.projectId}/site-health`);
      return {
        status: response.status,
        body: record(record(await response.json()).crawl).counters,
      };
    };
    const stored = async () =>
      (
        await db
          .selectFrom('site_crawls')
          .select('terminal_counters')
          .where('id', '=', seed.crawlId)
          .executeTakeFirstOrThrow()
      ).terminal_counters;
    // While the crawl runs nothing is persisted and its tasks are counted live.
    expect(await stored()).toBeNull();
    await fixtures.page(seed, '/b', {});
    expect(record((await counters()).body)).toMatchObject({
      analyzed: 2,
      by_page_kind: { product: 2 },
    });
    // The stop persists the counters in its own transaction.
    expect((await request(seed, `/site-crawls/${seed.crawlId}/cancel`, 'POST')).status).toBe(200);
    expect(record(await stored())).toMatchObject({
      analyzed: 2,
      activity: { state: 'terminal' },
      by_page_kind: { product: 2 },
    });
    // A task row no terminal owner counted changes nothing the dashboard reads.
    await fixtures.page(seed, '/late', {});
    expect(record((await counters()).body)).toMatchObject({
      analyzed: 2,
      activity: { state: 'terminal', reason: 'terminal' },
      by_page_kind: { product: 2 },
    });
    const outsider = await fixtures.crawl();
    expect((await counters(outsider)).status).toBe(404);
  });

  it('lists a crawl with the same counters its dashboard reads, live or persisted', async () => {
    const seed = await fixtures.crawl('running');
    await fixtures.page(seed, '/a', {});
    await fixtures.page(seed, '/b', {});
    const listed = async () => {
      const response = await request(seed, `/site-crawls?project_id=${seed.projectId}`);
      const items = record(await response.json()).items as unknown[];
      return record(record(items.find((item) => record(item).id === seed.crawlId)).counters);
    };
    expect(await listed()).toMatchObject({ analyzed: 2, by_page_kind: { product: 2 } });
    // A terminal crawl with no persisted counters is counted, never reported as zero.
    await db
      .updateTable('site_crawls')
      .set({ status: 'completed', completed_at: new Date() })
      .where('id', '=', seed.crawlId)
      .execute();
    expect(await listed()).toMatchObject({ analyzed: 2, by_page_kind: { product: 2 } });
    // Once persisted, the stored counters win over later task rows.
    await db
      .updateTable('site_crawls')
      .set({
        terminal_counters: JSON.stringify({
          ...(await listed()),
          analyzed: 5,
        }),
      })
      .where('id', '=', seed.crawlId)
      .execute();
    await fixtures.page(seed, '/late', {});
    expect(await listed()).toMatchObject({ analyzed: 5 });
  });

  it('retries an actual PostgreSQL crawl lock timeout before cancelling', async () => {
    const seed = await fixtures.crawl('running');
    const impatient = testDatabase({
      ...config,
      database: { ...config.database, lockTimeoutMs: 30 },
    });
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('site_crawls')
        .select('id')
        .where('id', '=', seed.crawlId)
        .forUpdate()
        .execute();
      locked();
      await hold;
    });
    try {
      await ready;
      const stop = cancelCrawl(impatient, seed.workspaceId, seed.crawlId);
      await setTimeout(70);
      release();
      await blocker;
      await stop;
      expect(
        (
          await db
            .selectFrom('site_crawls')
            .select('status')
            .where('id', '=', seed.crawlId)
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe('cancelled');
    } finally {
      release();
      await blocker;
      await impatient.destroy();
    }
  });

  it('audits the same tracked pages on every crawl action, refused while a crawl runs (SH-B7)', async () => {
    const seed = await fixtures.crawl();
    allow(3);
    const a = await fixtures.page(seed, '/a', {});
    const b = await fixtures.page(seed, '/b', {});
    await fixtures.monitor(seed, [a.id, b.id]);
    const start = () => request(seed, '/site-crawls', 'POST', { project_id: seed.projectId });
    const audited = async (crawlId: string) =>
      (
        await db
          .selectFrom('site_crawl_tasks as t')
          .innerJoin('site_urls as u', 'u.id', 't.site_url_id')
          .select('u.normalized_url')
          .where('t.crawl_id', '=', crawlId)
          .where('t.task_kind', '=', 'analyze')
          .orderBy('u.normalized_url')
          .execute()
      ).map((row) => row.normalized_url);
    const first = await start();
    expect(first.status).toBe(201);
    const source = siteCrawlSchema.parse(await first.json());
    expect((await start()).status).toBe(409);
    await db
      .updateTable('site_crawls')
      .set({ status: 'completed' })
      .where('id', '=', source.id)
      .execute();
    const second = await start();
    expect(second.status).toBe(201);
    const next = siteCrawlSchema.parse(await second.json());
    const pages = [`${seed.root}`, `${seed.root}a`, `${seed.root}b`];
    expect(await audited(source.id)).toEqual(pages);
    expect(await audited(next.id)).toEqual(pages);
    // The retired per-crawl recrawl route is gone.
    expect((await request(seed, `/site-crawls/${next.id}/recrawl`, 'POST')).status).toBe(404);
  });

  it('records who chose to ignore robots.txt, and a crawl naming no choice keeps it', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    const { email } = await db
      .selectFrom('users')
      .select('email')
      .where('id', '=', tenant.userId)
      .executeTakeFirstOrThrow();
    // The person is the signed-in caller; a body cannot name someone else.
    const forged = await request(tenant, '/site-crawls', 'POST', {
      project_id: tenant.projectId,
      robots: 'ignore',
      robots_decision: { user_id: randomUUID(), email: 'x@example.test', decided_at: null },
    });
    expect(forged.status).toBe(422);
    const created = await request(tenant, '/site-crawls', 'POST', {
      project_id: tenant.projectId,
      robots: 'ignore',
    });
    expect(created.status).toBe(201);
    const source = siteCrawlSchema.parse(await created.json());
    expect(source.robots).toMatchObject({ handling: 'ignore', decided_by_email: email });
    const frozen = async (id: string) =>
      record(
        (
          await db
            .selectFrom('site_crawls')
            .select('configuration')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).configuration,
      );
    expect(record((await frozen(source.id)).robots_decision).user_id).toBe(tenant.userId);

    await db
      .updateTable('site_crawls')
      .set({ status: 'completed' })
      .where('id', '=', source.id)
      .execute();
    const rerun = await request(tenant, '/site-crawls', 'POST', { project_id: tenant.projectId });
    expect(rerun.status).toBe(201);
    const next = siteCrawlSchema.parse(await rerun.json());
    expect(next.robots).toEqual(source.robots);
    expect((await frozen(next.id)).robots_decision).toEqual(
      (await frozen(source.id)).robots_decision,
    );

    // Choosing to respect robots.txt again replaces the kept choice.
    await db
      .updateTable('site_crawls')
      .set({ status: 'completed' })
      .where('id', '=', next.id)
      .execute();
    const plain = await request(tenant, '/site-crawls', 'POST', {
      project_id: tenant.projectId,
      robots: 'respect',
    });
    expect(siteCrawlSchema.parse(await plain.json()).robots).toEqual({
      handling: 'respect',
      decided_by_email: null,
      decided_at: null,
    });
  });

  it('refuses to ignore robots.txt without a confirming person', () => {
    expect(() => controls({ project_id: randomUUID(), robots: 'ignore' })).toThrow(
      'ignoring robots.txt needs a confirmed, signed-in person',
    );
  });

  it('serializes a terminal rerun with full-crawl admission and keeps one active run', async () => {
    const seed = await fixtures.crawl();
    allow(1);
    const page = await fixtures.page(seed, '/a', {});
    await fixtures.monitor(seed, [page.id]);
    await Promise.allSettled([
      create(seed),
      db.transaction().execute((trx) => rerunPage(trx, seed.workspaceId, seed.projectId, page.id)),
    ]);
    expect(
      await db
        .selectFrom('site_crawls')
        .select('id')
        .where('project_id', '=', seed.projectId)
        .where('status', 'in', ['queued', 'running'])
        .execute(),
    ).toHaveLength(1);
  });
});
