import { randomUUID } from 'node:crypto';

import type { Database } from '../src/db/database.ts';
import { SitePageFetcher, siteFetchSettings } from '../src/site-health/page-fetch.ts';
import { crawlCadences } from '../src/site-health/refresh-cadence.ts';
import { siteWorkerSettings } from '../src/site-health/runtime.ts';
import { runSiteSetup, type setupSettings } from '../src/site-health/site-setup-task.ts';
import { runSiteTask } from '../src/site-health/site-task.ts';
import { canonicalIdentity } from '../src/site-health/url-identity.ts';
import { SiteHealthWorker } from '../src/workers/site-health-worker.ts';
import {
  recordedSite,
  type Served,
  type SiteFixtures,
  type SiteSeed,
} from './site-health-fixtures.ts';

export const fetchSettings = siteFetchSettings({
  SITE_HEALTH_PER_HOST_DELAY_SECONDS: '0',
  SITE_HEALTH_DEFAULT_CRAWL_DELAY_SECONDS: '0',
  SITE_HEALTH_ROBOTS_TRANSIENT_BACKOFF_SECONDS: '0.001',
});
export const workerSettings = {
  ...siteWorkerSettings({}),
  concurrency: 1,
  retryBase: 0,
  retryMax: 0,
  retryJitter: 0,
};
export const html = (body: string, head = '') =>
  `<html><head><title>Page</title>${head}</head><body><main>${body}</main></body></html>`;
export const links = (...paths: string[]) =>
  html(paths.map((path) => `<a href="${path}">x</a>`).join(''));
export const url = (path: string) => `https://example.test${path}`;
export const urlset = (...paths: string[]) => ({
  contentType: 'application/xml',
  body: ['<urlset>', ...paths.map((path) => `<url><loc>${path}</loc></url>`), '</urlset>'].join(''),
});

type CrawlOptions = {
  sample?: boolean;
  config?: Record<string, unknown>;
  siteFacts?: unknown;
  discovery?: 'pending' | 'running';
};

export function acquisitionHarness(db: Database, fixtures: SiteFixtures) {
  async function crawl(options: CrawlOptions = {}, { monitored = 50, sample = 10 } = {}) {
    const seed = await fixtures.crawl('running');
    await db
      .updateTable('site_crawls')
      .set({
        completed_at: null,
        discovery_status: options.discovery ?? 'running',
        analysis_status: 'running',
        sample_mode: options.sample ?? false,
        site_facts: options.siteFacts === undefined ? null : JSON.stringify(options.siteFacts),
        configuration: JSON.stringify({
          root_registrable_domain: 'example.test',
          count_disclosure: true,
          ...options.config,
        }),
      })
      .where('id', '=', seed.crawlId)
      .execute();
    const now = new Date();
    await db
      .insertInto('workspace_site_health_runtime')
      .values({
        id: randomUUID(),
        workspace_id: seed.workspaceId,
        monitored_url_limit: monitored,
        sample_url_limit: sample,
        discovery_mode: 'full',
        count_disclosure: true,
        resolved_registry_revision: 'fixture',
        created_at: now,
        updated_at: now,
      })
      .execute();
    return seed;
  }
  async function queued(seed: SiteSeed, kind: 'discover' | 'site_setup', path = '/', depth = 0) {
    const identity = canonicalIdentity(path, seed.root);
    const id = await fixtures.task(seed, kind);
    await db
      .updateTable('site_crawl_tasks')
      .set({ url_hash: identity.hash, requested_url: identity.url, depth, site_url_id: null })
      .where('id', '=', id)
      .execute();
    return id;
  }
  function worker(pages: Record<string, Served>, requests: string[] = []) {
    return new SiteHealthWorker(db, {
      owner: 'acquisition-test',
      settings: workerSettings,
      fetcher: new SitePageFetcher(db, recordedSite(pages, requests), fetchSettings),
    });
  }
  function lease(taskId: string, owner: string) {
    return db
      .updateTable('site_crawl_tasks')
      .set({
        status: 'leased',
        lease_owner: owner,
        lease_expires_at: new Date(Date.now() + 60_000),
      })
      .where('id', '=', taskId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  async function run(site: SiteHealthWorker, ...taskIds: string[]) {
    for (const id of taskIds) await site.execute(await lease(id, site.owner)); // NOSONAR
  }
  async function walkSetup(
    site: SiteHealthWorker,
    taskId: string,
    settings: ReturnType<typeof setupSettings>,
  ) {
    await lease(taskId, site.owner);
    const runner = {
      db,
      owner: site.owner,
      queue: site.queue,
      fetcher: site.fetcher,
      settings: site.settings,
      cadence: crawlCadences(site.settings.scoreRefresh),
    };
    await runSiteTask(runner, await task(taskId), {
      kind: 'acquire',
      run: (ctx, claimed) => runSiteSetup(ctx, claimed, settings),
    });
  }
  const task = (id: string) =>
    db.selectFrom('site_crawl_tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const tasks = (seed: SiteSeed, kind: string) =>
    db
      .selectFrom('site_crawl_tasks')
      .selectAll()
      .where('crawl_id', '=', seed.crawlId)
      .where('task_kind', '=', kind)
      .orderBy('requested_url')
      .execute();
  const crawlRow = (seed: SiteSeed) =>
    db
      .selectFrom('site_crawls')
      .selectAll()
      .where('id', '=', seed.crawlId)
      .executeTakeFirstOrThrow();
  const urlRow = (seed: SiteSeed, path: string) =>
    db
      .selectFrom('site_urls')
      .selectAll()
      .where('project_id', '=', seed.projectId)
      .where('url_hash', '=', canonicalIdentity(path, seed.root).hash)
      .executeTakeFirstOrThrow();
  const memberships = (seed: SiteSeed) =>
    db
      .selectFrom('monitored_site_urls as m')
      .innerJoin('site_urls as u', 'u.id', 'm.site_url_id')
      .select(['u.normalized_url', 'm.active', 'm.selection_source'])
      .where('m.project_id', '=', seed.projectId)
      .orderBy('u.normalized_url')
      .execute();
  const observations = (seed: SiteSeed) =>
    db
      .selectFrom('site_url_observations')
      .select(['observed_url', 'source_kind', 'depth'])
      .where('crawl_id', '=', seed.crawlId)
      .orderBy('observed_url')
      .execute();
  const entries = (seed: SiteSeed) =>
    db
      .selectFrom('site_sitemap_entries')
      .select(['listed_url', 'lastmod'])
      .where('crawl_id', '=', seed.crawlId)
      .orderBy('listed_url')
      .execute();
  return {
    crawl,
    queued,
    worker,
    lease,
    run,
    walkSetup,
    task,
    tasks,
    crawlRow,
    urlRow,
    memberships,
    observations,
    entries,
  };
}
