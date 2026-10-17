import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  siteCrawlListPageSchema,
  siteCrawlSchema,
  monitoredUrlsResponseSchema,
  rerunPageResponseSchema,
} from '@citeladder/contracts/site-health';
import { createApp } from '../src/app.ts';
import { policy } from '../src/config.ts';
import { cancelCrawl } from '../src/site-health/controls.ts';
import { createCrawl } from '../src/site-health/planner.ts';
import { controls, normalizedSeed } from '../src/site-health/planner-policy.ts';
import { replaceMonitoredSet, rerunPage } from '../src/site-health/selection.ts';
import { publishCancelledCrawls } from '../src/site-health/lifecycle.ts';
import { record } from '../src/db/json.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
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

async function request(tenant: Tenant, path: string, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, {
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
async function otherProject(seed: SiteSeed) {
  const id = await fixtures.project(seed.workspaceId);
  await db.updateTable('projects').set({ website_url: seed.root }).where('id', '=', id).execute();
  const profileId = randomUUID();
  const now = new Date();
  await db
    .insertInto('site_health_profiles')
    .values({
      id: profileId,
      workspace_id: seed.workspaceId,
      project_id: id,
      root_url: seed.root,
      root_host: 'example.test',
      registrable_domain: 'example.test',
      selection_version: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const other = { ...seed, projectId: id, profileId };
  return { ...other, crawlId: await fixtures.sibling(other) };
}
async function create(tenant: Tenant, options: Record<string, unknown> = {}) {
  return db
    .transaction()
    .execute((trx) =>
      createCrawl(trx, tenant.workspaceId, { project_id: tenant.projectId, ...options }),
    );
}

describe('crawl control admission', () => {
  it('rejects an oversized monitored selection before opening its transaction', async () => {
    const seed = await fixtures.crawl();
    const transaction = vi.spyOn(db, 'transaction');
    try {
      const response = await request(seed, `/projects/${seed.projectId}/monitored-urls`, 'PUT', {
        site_url_ids: Array.from(
          { length: policy.site_health.crawl.monitored_url_selection_max + 1 },
          () => randomUUID(),
        ),
        expected_selection_version: 1,
      });
      expect(response.status).toBe(422);
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
  it('serializes two concurrent creates and seeds one root, setup and independent analysis plan', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow(2);
    const outcomes = await Promise.allSettled([
      create(tenant, { seed: '-1' }),
      create(tenant, { seed: '-1' }),
    ]);
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
    expect(tasks.map((task) => task.task_kind).sort()).toEqual([
      'analyze',
      'discover',
      'site_setup',
    ]);
    expect(crawl.random_seed).toBe('18446744073709551615');
    expect(record(crawl.configuration)).toMatchObject({
      monitored_url_limit: 2,
      automatic_monitor_limit: 2,
      page_profile_rule_version: policy.site_health.versions.rules,
    });
    expect(tasks.find((task) => task.task_kind === 'site_setup')!.priority).toBeGreaterThan(
      tasks.find((task) => task.task_kind === 'discover')!.priority,
    );
  });

  it('bounds a quota race across projects and rolls back the losing replacement', async () => {
    const first = await fixtures.crawl();
    const second = await otherProject(first);
    allow(1);
    const a = await fixtures.page(first, '/a', {});
    const b = await fixtures.page(second, '/b', {});
    const outcomes = await Promise.allSettled([
      db
        .transaction()
        .execute((trx) => replaceMonitoredSet(trx, first.workspaceId, first.projectId, [a.id], 1)),
      db
        .transaction()
        .execute((trx) =>
          replaceMonitoredSet(trx, second.workspaceId, second.projectId, [b.id], 1),
        ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
      status: 403,
      code: 'site_health_quota_exceeded',
      details: { limit: 1, currently_used: 1 },
    });
    expect(
      await db
        .selectFrom('monitored_site_urls')
        .select('id')
        .where('workspace_id', '=', first.workspaceId)
        .where('active', '=', true)
        .execute(),
    ).toHaveLength(1);
  });

  it('freezes exact seeds: the self-hosted operator always has advanced controls', async () => {
    vi.stubEnv('SITE_HEALTH_ADVANCED_CONTROLS_ENABLED', 'false');
    expect(() =>
      controls({
        project_id: randomUUID(),
        input_mode: 'exact_urls',
        seed_urls: ['https://example.test/a'],
      }),
    ).toThrow('advanced crawl controls');
    expect(() => normalizedSeed('not-an-int')).toThrow('integer');
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    const crawl = await create(tenant, {
      input_mode: 'exact_urls',
      requested_page_limit: 3,
      seed_urls: [
        'https://example.test/a#fragment',
        'https://example.test/a',
        'https://example.test/b',
      ],
      page_kinds: ['article'],
    });
    expect(record(crawl.configuration).seed_urls).toEqual([
      'https://example.test/a',
      'https://example.test/b',
    ]);
    const tasks = await db
      .selectFrom('site_crawl_tasks')
      .selectAll()
      .where('crawl_id', '=', crawl.id)
      .execute();
    expect(
      tasks
        .filter((task) => task.task_kind === 'discover')
        .map((task) => task.requested_url)
        .sort(),
    ).toEqual(['https://example.test/a', 'https://example.test/b']);
    expect(tasks.some((task) => task.task_kind === 'analyze')).toBe(false);
  });

  it('re-seeds only active in-scope monitored URLs and freezes full inventory lineage across a sample crawl', async () => {
    const seed = await fixtures.crawl();
    allow(3);
    const a = await fixtures.page(seed, '/a', {});
    const b = await fixtures.page(seed, '/b', {});
    const c = await fixtures.page(seed, '/c', {});
    await db
      .transaction()
      .execute((trx) =>
        replaceMonitoredSet(trx, seed.workspaceId, seed.projectId, [a.id, b.id, c.id], 1),
      );
    await db
      .transaction()
      .execute((trx) =>
        replaceMonitoredSet(trx, seed.workspaceId, seed.projectId, [a.id, c.id], 2),
      );
    const full = await create(seed, { exclude_globs: ['*/c'] });
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
    ).toEqual([a.id, root.id].sort());
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
    ).toEqual([a.id, root.id].sort());
    expect(record(full.configuration).inventory_source_crawl_ids).toEqual([seed.crawlId]);
    await cancelCrawl(db, seed.workspaceId, full.id);
    await fixtures.sibling(seed, { sample_mode: true, created_at: new Date(Date.now() + 1000) });
    const next = await create(seed);
    expect(record(next.configuration).inventory_source_crawl_ids).toEqual([full.id, seed.crawlId]);
  });

  it('lets the dev seed invoke real TypeScript creation and bulk selection through its local CLI', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow(2);
    async function seedControl(payload: Record<string, string>) {
      const child = spawn(process.execPath, ['scripts/seed-site-health.ts'], {
        cwd: new URL('../', import.meta.url),
        env: {
          APP_ENV: 'development',
          DATABASE_URL: process.env.API_TEST_DATABASE_URL,
          CITELADDER_DISABLE_DOTENV: '1',
        },
        windowsHide: true,
      });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
      });
      const ended = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      child.stdin.end(
        JSON.stringify({
          workspace_id: tenant.workspaceId,
          project_id: tenant.projectId,
          ...payload,
        }),
      );
      expect(await ended).toBe(0);
      return JSON.parse(output) as { id: string };
    }
    const crawl = await seedControl({ operation: 'create', seed: '99' });
    await seedControl({ operation: 'select', crawl_id: crawl.id });
    const selected = await db
      .selectFrom('monitored_site_urls')
      .select('selection_source')
      .where('project_id', '=', tenant.projectId)
      .execute();
    expect(selected).toEqual([{ selection_source: 'user' }]);
  });
});

describe('crawl-control HTTP contracts', () => {
  it('preserves coded plan errors and sanitizes invalid query identifiers', async () => {
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
      [
        '/site-crawls/url-preview',
        'POST',
        { project_id: foreign.projectId, content: foreign.root },
      ],
      [`/site-crawls?project_id=${foreign.projectId}`, 'GET'],
      [`/site-crawls/${foreign.crawlId}/cancel`, 'POST'],
      [`/site-crawls/${foreign.crawlId}/recrawl`, 'POST'],
      [`/projects/${foreign.projectId}/monitored-urls`, 'GET'],
      [
        `/projects/${foreign.projectId}/monitored-urls`,
        'PUT',
        { site_url_ids: [page.id], expected_selection_version: 1 },
      ],
      [
        `/projects/${foreign.projectId}/monitored-urls/bulk-select`,
        'POST',
        { crawl_id: foreign.crawlId, mode: 'all', expected_selection_version: 1 },
      ],
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
    expect(
      (
        await request(reader, '/site-crawls/url-preview', 'POST', {
          project_id: seed.projectId,
          content: seed.root,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(reader, '/site-crawls', 'POST', { project_id: seed.projectId })).status,
    ).toBe(403);
    expect((await request(reader, `/site-crawls/${seed.crawlId}/cancel`, 'POST')).status).toBe(403);
    expect((await request(reader, `/site-crawls/${seed.crawlId}/recrawl`, 'POST')).status).toBe(
      403,
    );
    vi.stubEnv('ABUSE_CRAWL_CREATE_LIMIT', '1');
    const first = await request(seed, '/site-crawls', 'POST', { project_id: randomUUID() });
    expect(first.status).toBe(404);
    expect(
      (await request(seed, '/site-crawls', 'POST', { project_id: seed.projectId })).status,
    ).toBe(429);
  });

  it('previews CSV/JSON duplicates and scope rejections without creating runtime or crawl rows', async () => {
    const seed = await fixtures.crawl();
    for (const input of [
      {
        input_format: 'csv',
        content: 'https://example.test/a,extra\nhttps://example.test/a#x\nhttps://outside.test/',
      },
      {
        input_format: 'json',
        content: {
          urls: [
            { url: 'https://example.test/a' },
            { url: 'https://example.test/a#x' },
            { url: 'https://outside.test/' },
          ],
        },
      },
    ]) {
      const response = await request(seed, '/site-crawls/url-preview', 'POST', {
        project_id: seed.projectId,
        ...input,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        counts: { accepted: 1, duplicate: 1, rejected: 1 },
      });
    }
    expect(
      await db
        .selectFrom('workspace_site_health_runtime')
        .select('id')
        .where('workspace_id', '=', seed.workspaceId)
        .execute(),
    ).toHaveLength(0);
    const oversized = await request(seed, '/site-crawls/url-preview', 'POST', {
      project_id: seed.projectId,
      content: {
        urls: ['x'.repeat(Number(policy.site_health.settings.max_preview_input_bytes.default) + 1)],
      },
    });
    expect(oversized.status).toBe(422);
    vi.stubEnv('SITE_HEALTH_MAX_PREVIEW_ROWS', '2');
    for (const [count, truncated] of [
      [2, false],
      [3, true],
    ] as const) {
      const boundary = await request(seed, '/site-crawls/url-preview', 'POST', {
        project_id: seed.projectId,
        content: Array.from({ length: count }, (_, index) => `${seed.root}${index}`),
      });
      const preview = record(await boundary.json());
      expect(preview.truncated).toBe(truncated);
      expect(preview.items).toHaveLength(2);
    }
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

  it('replaces, rejects stale/foreign ids, cancels only pending removals and advances generations on re-add', async () => {
    const seed = await fixtures.crawl('running');
    allow(2);
    const page = await fixtures.page(seed, '/a', {});
    const path = `/projects/${seed.projectId}/monitored-urls`;
    const update = (ids: string[], version: number) =>
      request(seed, path, 'PUT', { site_url_ids: ids, expected_selection_version: version });
    const selected = monitoredUrlsResponseSchema.parse(
      await (await update([page.id, page.id], 1)).json(),
    );
    expect(selected.quota.used).toBe(1);
    const stale = await update([], 1);
    expect(stale.status).toBe(409);
    const staleBody = record(await stale.json());
    expect(staleBody).toMatchObject({
      error: {
        code: 'stale_selection_version',
        retryable: false,
        details: { current_selection_version: 2 },
      },
    });
    expect((await update([randomUUID()], 2)).status).toBe(422);
    await update([], 2);
    await update([page.id], 3);
    const tasks = await db
      .selectFrom('site_crawl_tasks')
      .select(['generation', 'status'])
      .where('crawl_id', '=', seed.crawlId)
      .where('site_url_id', '=', page.id)
      .where('status', '!=', 'succeeded')
      .orderBy('generation')
      .execute();
    expect(tasks).toEqual([
      { generation: 0, status: 'cancelled' },
      { generation: 1, status: 'queued' },
    ]);
    const history = monitoredUrlsResponseSchema.parse(await (await request(seed, path)).json());
    expect(history.selection_version).toBe(4);
  });

  it('bulk selects the inventory lineage in URL order with literal display-url filtering, bounded quota and clear', async () => {
    const seed = await fixtures.crawl();
    allow(2);
    const b = await fixtures.page(seed, '/b', {}, { observed: true });
    const a = await fixtures.page(seed, '/a', {}, { observed: true });
    await db
      .updateTable('site_urls')
      .set({ display_url: 'literal_needle' })
      .where('id', '=', a.id)
      .execute();
    const latest = await fixtures.sibling(seed, {
      configuration: JSON.stringify({ inventory_source_crawl_ids: [seed.crawlId] }),
    });
    const path = `/projects/${seed.projectId}/monitored-urls/bulk-select`;
    const select = (mode: string, version: number, extra: Record<string, unknown> = {}) =>
      request(seed, path, 'POST', {
        crawl_id: latest,
        mode,
        expected_selection_version: version,
        ...extra,
      });
    const first = monitoredUrlsResponseSchema.parse(
      await (await select('first_n', 1, { count: 1, query: '_needle' })).json(),
    );
    expect(first.monitored_urls.filter((url) => url.active).map((url) => url.site_url_id)).toEqual([
      a.id,
    ]);
    const all = monitoredUrlsResponseSchema.parse(await (await select('all', 2)).json());
    expect(all.monitored_urls.filter((url) => url.active).map((url) => url.site_url_id)).toEqual([
      a.id,
      b.id,
    ]);
    await fixtures.page(seed, '/c', {}, { observed: true });
    expect((await select('all', 3)).status).toBe(403);
    expect((await select('first_n', 3)).status).toBe(422);
    const none = monitoredUrlsResponseSchema.parse(await (await select('none', 3)).json());
    expect(none.quota.used).toBe(0);
    expect(none.monitored_urls).toHaveLength(2);
  });

  it('bulk selects the most valuable pages first, not the alphabetically first', async () => {
    const seed = await fixtures.crawl();
    allow(1);
    await fixtures.page(seed, '/about', {}, { observed: true });
    const product = await fixtures.page(seed, '/zebra-product', {}, { observed: true });
    await db
      .updateTable('site_url_observations')
      .set({ value_priority: 90 })
      .where('site_url_id', '=', product.id)
      .execute();
    const response = await request(
      seed,
      `/projects/${seed.projectId}/monitored-urls/bulk-select`,
      'POST',
      { crawl_id: seed.crawlId, mode: 'first_n', count: 1, expected_selection_version: 1 },
    );
    const selected = monitoredUrlsResponseSchema.parse(await response.json());
    expect(
      selected.monitored_urls.filter((url) => url.active).map((url) => url.site_url_id),
    ).toEqual([product.id]);
  });

  it('reruns a terminal monitored page as one fresh analysis, then reuses the active crawl at the next generation', async () => {
    const seed = await fixtures.crawl();
    allow(1);
    const page = await fixtures.page(seed, '/a', {}, { observed: true });
    await db
      .transaction()
      .execute((trx) => replaceMonitoredSet(trx, seed.workspaceId, seed.projectId, [page.id], 1));
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
    expect(first.created_new_crawl).toBe(true);
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
    const second = rerunPageResponseSchema.parse(await (await request(seed, path, 'POST')).json());
    expect(second).toMatchObject({ crawl_id: first.crawl_id, created_new_crawl: false });
    expect(
      (
        await db
          .selectFrom('site_crawl_tasks')
          .select('generation')
          .where('id', '=', second.task_id)
          .executeTakeFirstOrThrow()
      ).generation,
    ).toBe(1);
    expect(
      (await request(seed, `/site-crawls/${seed.crawlId}/pages/${randomUUID()}/rerun`, 'POST'))
        .status,
    ).toBe(404);
  });

  it('keeps Stop short and lets the worker publish retained analysis evidence exactly once', async () => {
    const seed = await fixtures.crawl('running');
    allow(1);
    const page = await fixtures.page(seed, '/a', {});
    await db
      .transaction()
      .execute((trx) => replaceMonitoredSet(trx, seed.workspaceId, seed.projectId, [page.id], 1));
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

  it('recrawls with the source crawl scope and seed, and refuses while a crawl is active', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    const created = await request(tenant, '/site-crawls', 'POST', {
      project_id: tenant.projectId,
      exclude_globs: ['/private/*'],
      requested_page_limit: 5,
      seed: '42',
    });
    expect(created.status).toBe(201);
    const source = siteCrawlSchema.parse(await created.json());
    const busy = await request(tenant, `/site-crawls/${source.id}/recrawl`, 'POST');
    expect(busy.status).toBe(409);
    await db
      .updateTable('site_crawls')
      .set({ status: 'completed' })
      .where('id', '=', source.id)
      .execute();

    const rerun = await request(tenant, `/site-crawls/${source.id}/recrawl`, 'POST');
    expect(rerun.status).toBe(201);
    const next = siteCrawlSchema.parse(await rerun.json());
    const scope = (id: string) =>
      db
        .selectFrom('site_crawls')
        .select(['random_seed', 'configuration'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
        .then(({ random_seed, configuration }) => {
          const frozen = record(configuration);
          return {
            random_seed,
            exclude_globs: frozen.exclude_globs,
            include_globs: frozen.include_globs,
            input_mode: frozen.input_mode,
            requested_page_limit: frozen.requested_page_limit,
          };
        });
    expect(next.id).not.toBe(source.id);
    expect(await scope(next.id)).toEqual({
      random_seed: '42',
      exclude_globs: ['/private/*'],
      include_globs: [],
      input_mode: 'auto',
      requested_page_limit: 5,
    });
    expect(await scope(next.id)).toEqual(await scope(source.id));

    // After a one-page re-read, Recrawl reruns the site crawl, not the one page.
    await db
      .updateTable('site_crawls')
      .set({ status: 'completed' })
      .where('id', '=', next.id)
      .execute();
    const row = await db
      .selectFrom('site_crawls')
      .select(['profile_id', 'root_url'])
      .where('id', '=', next.id)
      .executeTakeFirstOrThrow();
    const reread = await fixtures.sibling(
      { ...tenant, profileId: row.profile_id, root: row.root_url, crawlId: '' },
      {
        random_seed: '7',
        configuration: { page_rerun: true, requested_page_limit: 1, input_mode: 'auto' },
        created_at: new Date(Date.now() + 1000),
      },
    );
    const again = await request(tenant, `/site-crawls/${reread}/recrawl`, 'POST');
    expect(again.status).toBe(201);
    expect(await scope(siteCrawlSchema.parse(await again.json()).id)).toEqual(
      await scope(source.id),
    );
  });

  it('serializes a terminal rerun with full-crawl admission and keeps one active run', async () => {
    const seed = await fixtures.crawl();
    allow(1);
    const page = await fixtures.page(seed, '/a', {});
    await db
      .transaction()
      .execute((trx) => replaceMonitoredSet(trx, seed.workspaceId, seed.projectId, [page.id], 1));
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
