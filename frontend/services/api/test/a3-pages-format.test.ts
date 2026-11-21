import { afterAll, describe, expect, it } from 'vitest';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';
import { pagesRead } from '../src/ai-traffic/pages.ts';

const db = testDatabase(),
  fixtures = new SiteFixtures(db);
const day = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('Pages path formatting', () => {
  it('derives the same path, folder and resource class on a page as under a filter', async () => {
    const seed = await fixtures.crawl();
    for (const path of ['/known', '/docs/Guides/Deep/News.RSS', '/robots.txt'])
      await fixtures.page(seed, path, {}, { observed: true });
    const scope = { workspaceId: seed.workspaceId, projectId: seed.projectId };
    const shape = async (extra: Record<string, string>) =>
      (
        await pagesRead(db, scope, { start_date: day, end_date: day, sort: 'url_asc', ...extra })
      ).items.map((r) => [r.display_path, r.folder, r.resource_class]);
    expect(await shape({})).toEqual([
      ['/docs/Guides/Deep/News.RSS', '/docs/Guides', 'feed'],
      ['/known', '/known', 'page'],
      ['/robots.txt', '/robots.txt', 'robots'],
    ]);
    expect(await shape({ resource_class: 'feed' })).toEqual([
      ['/docs/Guides/Deep/News.RSS', '/docs/Guides', 'feed'],
    ]);
    expect(await shape({ folder: '/robots.txt' })).toEqual([
      ['/robots.txt', '/robots.txt', 'robots'],
    ]);
  });
});
