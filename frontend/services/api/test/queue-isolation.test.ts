import pg from 'pg';
import { afterAll, expect, it, onTestFinished } from 'vitest';
import { fixtureWorkspaceName } from './fixture-workspace.ts';
import { quiesceFixtureQueues } from './queue-isolation.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase(),
  fixtures = new SiteFixtures(db);
afterAll(() => db.destroy());

it('settles fixture work but never ends the local app crawl that shares the database', async () => {
  const fixture = await fixtures.crawl('running');
  const app = await fixtures.crawl('running');
  const rename = (name: string) =>
    db.updateTable('workspaces').set({ name }).where('id', '=', app.workspaceId).execute();
  await rename('Local app');
  // Whatever the outcome, the workspace is a fixture again for later files to settle.
  onTestFinished(() => rename(fixtureWorkspaceName(app.workspaceId)).then(() => undefined));
  const fixtureTask = await fixtures.task(fixture, 'discover');
  const appTask = await fixtures.task(app, 'discover');

  const client = new pg.Client({ connectionString: process.env.API_TEST_DATABASE_URL });
  await client.connect();
  try {
    await quiesceFixtureQueues(client);
  } finally {
    await client.end();
  }

  const crawls = await db
    .selectFrom('site_crawls')
    .select(['id', 'status'])
    .where('id', 'in', [fixture.crawlId, app.crawlId])
    .execute();
  const tasks = await db
    .selectFrom('site_crawl_tasks')
    .select(['id', 'status'])
    .where('id', 'in', [fixtureTask, appTask])
    .execute();
  const status = (rows: { id: string; status: string }[], id: string) =>
    rows.find((row) => row.id === id)?.status;
  expect(status(crawls, fixture.crawlId)).toBe('failed');
  expect(status(tasks, fixtureTask)).toBe('cancelled');
  expect(status(crawls, app.crawlId)).toBe('running');
  expect(status(tasks, appTask)).toBe('queued');
});
