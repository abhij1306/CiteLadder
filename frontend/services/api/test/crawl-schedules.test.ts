import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { crawlScheduleSchema } from '@citeladder/contracts/site-health';
import { createApp } from '../src/app.ts';
import { cancelCrawl } from '../src/site-health/controls.ts';
import { nextOccurrence, updateSchedule } from '../src/site-health/schedules.ts';
import { CrawlScheduler, crawlSchedulerSettings } from '../src/workers/crawl-scheduler.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
const settings = crawlSchedulerSettings({});
const DAY = 86_400_000;
// Occurrences sit a year ahead, so a scheduled tick running beside this file
// on the shared database never finds them due.
const base = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 4, 9));
const firstRun = new Date(base.getTime() + 7 * DAY);
const due = new Date(firstRun.getTime() + 60_000);

afterEach(async () => {
  vi.unstubAllEnvs();
  await fixtures.cleanup();
});
afterAll(() => db.destroy());

/** Two tracked pages: the operator's workspace-wide monitored-URL limit. */
function allow() {
  vi.stubEnv('SITE_HEALTH_MONITORED_URL_LIMIT', '2');
}
function weekly(tenant: Tenant, enabled = true) {
  return db
    .transaction()
    .execute((trx) =>
      updateSchedule(
        trx,
        tenant.workspaceId,
        tenant.projectId,
        { enabled, cadence: 'weekly' },
        base,
      ),
    );
}
function schedule(tenant: Tenant) {
  return db
    .selectFrom('crawl_schedules')
    .selectAll()
    .where('workspace_id', '=', tenant.workspaceId)
    .where('project_id', '=', tenant.projectId)
    .executeTakeFirstOrThrow();
}
function crawls(tenant: Tenant) {
  return db
    .selectFrom('site_crawls')
    .selectAll()
    .where('workspace_id', '=', tenant.workspaceId)
    .where('project_id', '=', tenant.projectId)
    .orderBy('created_at')
    .execute();
}
async function request(tenant: Tenant, projectId: string, body?: unknown) {
  return app.request(`/api/v1/projects/${projectId}/crawl-schedule`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const scheduler = (owner: string) => new CrawlScheduler(db, settings, { owner, now: () => due });

describe('scheduled crawl occurrences', () => {
  it('starts a due crawl through admission and plans the next week', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow();
    await weekly(tenant);

    expect(await scheduler('first').runOnce(due)).toBe(1);

    const [crawl] = await crawls(tenant);
    // Two tracked pages: the crawl's page limit is two.
    expect(crawl).toMatchObject({
      status: 'queued',
      configuration: expect.objectContaining({ requested_page_limit: 2 }),
    });
    expect(await schedule(tenant)).toMatchObject({
      enabled: true,
      next_run_at: new Date(base.getTime() + 14 * DAY),
      last_run_at: due,
      last_outcome: 'created',
      last_crawl_id: crawl!.id,
      lease_owner: null,
      failure_count: 0,
    });

    // The next occurrence audits the same tracked pages, as every crawl action does.
    await cancelCrawl(db, tenant.workspaceId, crawl!.id);
    const later = new Date(base.getTime() + 14 * DAY + 60_000);
    const next = new CrawlScheduler(db, settings, { owner: 'first', now: () => later });
    expect(await next.runOnce(later)).toBe(1);
    const [, rerun] = await crawls(tenant);
    const audited = async (crawlId: string) =>
      (
        await db
          .selectFrom('site_crawl_tasks')
          .select('requested_url')
          .where('crawl_id', '=', crawlId)
          .where('task_kind', '=', 'analyze')
          .execute()
      ).map((task) => task.requested_url);
    expect(await audited(rerun!.id)).toEqual(['https://example.test/']);
    expect(await audited(rerun!.id)).toEqual(await audited(crawl!.id));
  });

  it('skips an occurrence while a crawl is active, without counting a failure', async () => {
    const seed = await fixtures.crawl('running');
    // An admitted crawl freezes its robots choice, which the next crawl action keeps.
    await db
      .updateTable('site_crawls')
      .set({ configuration: JSON.stringify({ robots: 'respect' }) })
      .where('id', '=', seed.crawlId)
      .execute();
    allow();
    await weekly(seed);

    expect(await scheduler('active').runOnce(due)).toBe(0);

    expect((await crawls(seed)).map((crawl) => crawl.id)).toEqual([seed.crawlId]);
    expect(await schedule(seed)).toMatchObject({
      enabled: true,
      next_run_at: new Date(base.getTime() + 14 * DAY),
      last_run_at: null,
      last_outcome: 'crawl_already_active',
      failure_count: 0,
      lease_owner: null,
    });
  });

  it('keeps the latest crawl’s choice to ignore robots.txt and who confirmed it', async () => {
    const seed = await fixtures.crawl('completed');
    const decision = {
      user_id: seed.userId,
      email: 'owner@example.test',
      decided_at: '2026-01-02T03:04:05.000Z',
    };
    await db
      .updateTable('site_crawls')
      .set({
        configuration: JSON.stringify({
          robots: 'ignore',
          robots_decision: decision,
        }),
      })
      .where('id', '=', seed.crawlId)
      .execute();
    allow();
    await weekly(seed);

    expect(await scheduler('robots').runOnce(due)).toBe(1);

    const [, scheduled] = await crawls(seed);
    expect(scheduled!.configuration).toMatchObject({
      robots: 'ignore',
      robots_decision: decision,
    });
  });

  it('counts any other refusal as a failure and retries it later', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow();
    await weekly(tenant);
    await db
      .updateTable('projects')
      .set({ website_url: 'not a website' })
      .where('id', '=', tenant.projectId)
      .execute();

    expect(await scheduler('failing').runOnce(due)).toBe(0);

    expect(await schedule(tenant)).toMatchObject({
      enabled: true,
      failure_count: 1,
      last_outcome: 'failed',
      last_error: 'invalid_root',
      next_run_at: new Date(due.getTime() + settings.failure_retry_seconds * 1000),
    });
  });

  it('turns itself off after the last allowed failure, and turning it back on starts clean', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow();
    await weekly(tenant);
    await db
      .updateTable('projects')
      .set({ website_url: 'not a website' })
      .where('id', '=', tenant.projectId)
      .execute();
    await db
      .updateTable('crawl_schedules')
      .set({ failure_count: 4 })
      .where('project_id', '=', tenant.projectId)
      .execute();

    expect(await scheduler('exhausted').runOnce(due)).toBe(0);

    expect(await schedule(tenant)).toMatchObject({
      enabled: false,
      next_run_at: null,
      failure_count: 5,
      last_outcome: 'failed',
      last_error: 'invalid_root',
    });

    await weekly(tenant);
    expect(await schedule(tenant)).toMatchObject({
      enabled: true,
      next_run_at: firstRun,
      failure_count: 0,
      last_outcome: null,
      last_error: '',
    });
  });

  it('gives one due occurrence to one of two concurrent schedulers and leaves a live lease alone', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow();
    await weekly(tenant);

    const started = await Promise.all([
      scheduler('one').runOnce(due),
      scheduler('two').runOnce(due),
    ]);
    expect(started.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await crawls(tenant)).toHaveLength(1);

    // A schedule another owner holds is not claimed until its lease expires.
    const other = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    await weekly(other);
    await db
      .updateTable('crawl_schedules')
      .set({ lease_owner: 'elsewhere', lease_expires_at: new Date(Date.now() + 600_000) })
      .where('project_id', '=', other.projectId)
      .execute();
    expect(await scheduler('three').claimDue(due)).toEqual([]);
    await db
      .updateTable('crawl_schedules')
      .set({ lease_expires_at: new Date(Date.now() - 1000) })
      .where('project_id', '=', other.projectId)
      .execute();
    expect(await scheduler('three').claimDue(due)).toEqual([
      {
        id: (await schedule(other)).id,
        workspaceId: other.workspaceId,
        projectId: other.projectId,
        scheduledFor: firstRun,
      },
    ]);
  });

  it('drops an occurrence the person turned off after it was claimed', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    allow();
    await weekly(tenant);
    const owner = scheduler('stale');
    const [claim] = await owner.claimDue(due);
    await weekly(tenant, false);

    expect(await owner.planClaim(claim!, due)).toBe(false);

    expect(await crawls(tenant)).toEqual([]);
    expect(await schedule(tenant)).toMatchObject({
      enabled: false,
      next_run_at: null,
      lease_owner: null,
    });
  });
});

describe('crawl schedule routes', () => {
  it('reads off by default, turns on weekly, and refuses another workspace', async () => {
    const owner = await fixtures.tenant();
    const outsider = await fixtures.tenant();

    const initial = await request(owner, owner.projectId);
    expect(crawlScheduleSchema.parse(await initial.json())).toEqual({
      project_id: owner.projectId,
      enabled: false,
      cadence: 'weekly',
      next_run_at: null,
      last_run_at: null,
      last_outcome: null,
      last_crawl_id: null,
    });

    const before = Date.now();
    const saved = await request(owner, owner.projectId, { enabled: true, cadence: 'monthly' });
    expect(saved.status).toBe(200);
    const body = crawlScheduleSchema.parse(await saved.json());
    expect(body).toMatchObject({ enabled: true, cadence: 'monthly' });
    const next = new Date(body.next_run_at!);
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 28 * DAY);
    expect(next.getTime()).toBeLessThanOrEqual(Date.now() + 31 * DAY);

    expect((await request(outsider, owner.projectId)).status).toBe(404);
    const refused = await request(outsider, owner.projectId, { enabled: false, cadence: 'weekly' });
    expect(refused.status).toBe(404);
    expect(await schedule(owner)).toMatchObject({ enabled: true, cadence: 'monthly' });
  });

  it('refuses a cadence it does not offer', async () => {
    const owner = await fixtures.tenant();
    const response = await request(owner, owner.projectId, { enabled: true, cadence: 'daily' });
    expect(response.status).toBe(422);
  });
});

describe('cadence', () => {
  it('steps a month to the same day, clamped to a short month', () => {
    expect(
      nextOccurrence(
        'monthly',
        new Date('2027-01-31T09:00:00Z'),
        new Date('2027-01-31T09:00:00Z'),
      ).toISOString(),
    ).toBe('2027-02-28T09:00:00.000Z');
  });

  it('skips the weeks that passed while no runner was up', () => {
    expect(
      nextOccurrence(
        'weekly',
        new Date('2027-01-01T09:00:00Z'),
        new Date('2027-01-20T12:00:00Z'),
      ).toISOString(),
    ).toBe('2027-01-22T09:00:00.000Z');
  });
});
