import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { record } from '../src/db/json.ts';
import { cancelCrawl } from '../src/site-health/controls.ts';
import { crawlRequest } from '../src/site-health/crawl-request.ts';
import { createCrawl } from '../src/site-health/planner.ts';
import { rerunPage } from '../src/site-health/selection.ts';
import { testConfig, testDatabase } from './support.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const db = testDatabase(testConfig());
const fixtures = new SiteFixtures(db);
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function create(tenant: Tenant, options: Record<string, unknown> = {}) {
  return db
    .transaction()
    .execute((trx) =>
      createCrawl(trx, tenant.workspaceId, { project_id: tenant.projectId, ...options }),
    );
}
async function frozen(crawlId: string) {
  const crawl = await db
    .selectFrom('site_crawls')
    .select('configuration')
    .where('id', '=', crawlId)
    .executeTakeFirstOrThrow();
  return record(crawl.configuration);
}
async function finish(crawlId: string, status: 'completed' | 'failed') {
  await db.updateTable('site_crawls').set({ status }).where('id', '=', crawlId).execute();
}

describe('the crawl a project asks for next', () => {
  it('re-audits a page under the robots choice a person made, never a failed crawl’s', async () => {
    const tenant = await fixtures.tenant({ websiteUrl: 'https://example.test/' });
    const decision = {
      user_id: tenant.userId,
      email: 'owner@example.test',
      decided_at: '2026-11-01T00:00:00.000Z',
    };
    const ignoring = await create(tenant, { robots: 'ignore', robots_decision: decision });
    await finish(ignoring.id, 'completed');
    const root = await db
      .selectFrom('monitored_site_urls')
      .select('site_url_id')
      .where('project_id', '=', tenant.projectId)
      .executeTakeFirstOrThrow();
    const rerun = await db
      .transaction()
      .execute((trx) => rerunPage(trx, tenant.workspaceId, tenant.projectId, root.site_url_id));
    expect(await frozen(rerun.crawl_id)).toMatchObject({
      page_rerun: true,
      robots: 'ignore',
      robots_decision: decision,
    });

    await finish(rerun.crawl_id, 'completed');
    const respecting = await create(tenant, { robots: 'respect' });
    await finish(respecting.id, 'completed');
    const failed = await create(tenant, { robots: 'ignore', robots_decision: decision });
    await finish(failed.id, 'failed');
    expect(await crawlRequest(db, tenant.workspaceId, tenant.projectId)).toEqual({
      project_id: tenant.projectId,
      robots: 'respect',
    });
  });

  it('takes its inventory lineage from full site crawls, never a page rerun', async () => {
    const seed = await fixtures.crawl();
    vi.stubEnv('SITE_HEALTH_MONITORED_URL_LIMIT', '3');
    const page = await fixtures.page(seed, '/a', {});
    await fixtures.monitor(seed, [page.id]);
    const full = await create(seed);
    await cancelCrawl(db, seed.workspaceId, full.id);
    await fixtures.sibling(seed, {
      configuration: { page_rerun: true, inventory_source_crawl_ids: [] },
      created_at: new Date(Date.now() + 1000),
    });
    const next = await create(seed);
    expect(record(next.configuration).inventory_source_crawl_ids).toEqual([full.id, seed.crawlId]);
  });
});
