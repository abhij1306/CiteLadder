import { robotsHistoryPageSchema } from '@citeladder/contracts/site-health';
import { afterAll, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { insertRobotsSnapshot } from '../src/site-health/robots-snapshots.ts';
import { crawlerRootFacts } from '../src/site-health/crawler-policy.ts';
import { robotsPolicy } from '../src/web-evidence/acquisition.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
const origin = 'https://example.test';
async function get(seed: SiteSeed, projectId = seed.projectId, query = '') {
  return app.request(`/api/v1/projects/${projectId}/site-health/robots-history${query}`, {
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: seed.userId, ver: 0 })}`,
      'x-workspace-id': seed.workspaceId,
    },
  });
}
async function observe(seed: SiteSeed, crawlId: string, body: string, time: number) {
  return db.transaction().execute(async (trx) => {
    const snapshot = await insertRobotsSnapshot(
      trx,
      { workspace_id: seed.workspaceId, project_id: seed.projectId },
      origin,
      body,
      200,
      524288,
    );
    await trx
      .updateTable('site_crawls')
      .set({
        created_at: new Date(time),
        robots_snapshot_id: snapshot.id,
        robots_observed_at: new Date(time),
        site_facts: JSON.stringify({
          robots: {
            observed_at: new Date(time).toISOString(),
            catalog_version: '1',
            robots_snapshot_id: snapshot.id,
            fetched: true,
            status: 'fetched',
            status_code: 200,
            url: `${origin}/robots.txt`,
            sitemaps: [],
            bots: crawlerRootFacts(robotsPolicy(origin, 200, body), origin),
          },
        }),
      })
      .where('workspace_id', '=', seed.workspaceId)
      .where('id', '=', crawlId)
      .execute();
    return snapshot;
  });
}
it('deduplicates A→B→A while paging three observations and isolating workspaces', async () => {
  const seed = await fixtures.crawl();
  const second = await fixtures.sibling(seed);
  const third = await fixtures.sibling(seed);
  const a = 'User-agent: *\nAllow: /';
  const b = 'User-agent: *\nDisallow: /';
  const firstSnapshot = await observe(seed, seed.crawlId, a, Date.UTC(2026, 0, 1));
  const secondSnapshot = await observe(seed, second, b, Date.UTC(2026, 0, 2));
  const thirdSnapshot = await observe(seed, third, a, Date.UTC(2026, 0, 3));
  const unobserved = await fixtures.sibling(seed);
  await db
    .updateTable('site_crawls')
    .set({ site_facts: JSON.stringify({}), robots_observed_at: null })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', unobserved)
    .execute();
  expect(thirdSnapshot.id).toBe(firstSnapshot.id);
  expect(secondSnapshot.id).not.toBe(firstSnapshot.id);
  const response = await get(seed, seed.projectId, '?limit=2');
  expect(response.status).toBe(200);
  const page = robotsHistoryPageSchema.parse(await response.json());
  expect(page.items.map((row) => row.crawl_id)).toEqual([third, second]);
  expect(page.snapshots.map((row) => row.id).sort()).toEqual(
    [firstSnapshot.id, secondSnapshot.id].sort(),
  );
  const next = robotsHistoryPageSchema.parse(
    await (await get(seed, seed.projectId, `?limit=2&cursor=${page.next_cursor}`)).json(),
  );
  expect(next.items.map((row) => row.crawl_id)).toEqual([seed.crawlId]);
  expect(next.items[0]!.robots.bots[0]!.root_access).toBe('allowed');
  expect(next.next_cursor).toBeNull();
  const other = await fixtures.crawl();
  await observe(other, other.crawlId, a, Date.UTC(2026, 0, 4));
  expect((await get(other, seed.projectId)).status).toBe(404);
  expect((await get(other, other.projectId, `?cursor=${page.next_cursor}`)).status).toBe(400);
  const isolated = robotsHistoryPageSchema.parse(await (await get(other)).json());
  expect(isolated.items.map((row) => row.crawl_id)).toEqual([other.crawlId]);
  expect(isolated.snapshots[0]!.id).not.toBe(firstSnapshot.id);
  await expect(
    db
      .updateTable('site_crawls')
      .set({ robots_snapshot_id: firstSnapshot.id })
      .where('workspace_id', '=', other.workspaceId)
      .where('id', '=', other.crawlId)
      .execute(),
  ).rejects.toMatchObject({ code: '23503' });
});
it('bounds snapshot UTF-8 bodies while hashing the complete response', async () => {
  const seed = await fixtures.crawl();
  const scope = { workspace_id: seed.workspaceId, project_id: seed.projectId };
  const first = await insertRobotsSnapshot(db, scope, origin, 'aéz', 200, 2);
  const second = await insertRobotsSnapshot(db, scope, origin, 'aéother', 200, 2);
  const retained = await db
    .selectFrom('robots_snapshots')
    .select(['body', 'truncated'])
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', first.id)
    .executeTakeFirstOrThrow();
  expect(retained).toEqual({ body: 'a', truncated: true });
  expect(second.id).not.toBe(first.id);
});
