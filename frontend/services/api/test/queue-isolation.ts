import { ACTIVE_CRAWL_STATUSES } from '@citeladder/contracts/site-health';
import pg from 'pg';
import { beforeAll } from 'vitest';
import { policy } from '../src/config.ts';
import { FIXTURE_WORKSPACE_ROW } from './fixture-workspace.ts';

export async function quiesceFixtureQueues(client: pg.ClientBase) {
  const active = policy.task_queue.active;
  await client.query(
    `update site_crawls set status = 'failed', completed_at = coalesce(completed_at, now())
     where status = any($1::text[]) and ${FIXTURE_WORKSPACE_ROW}`,
    [ACTIVE_CRAWL_STATUSES],
  );
  await Promise.all(
    ['site_crawl_tasks', 'analytics_tasks', 'brand_discovery_tasks'].map((table) =>
      client.query(
        `update ${table} set status = 'cancelled', lease_owner = null, lease_expires_at = null
         where status = any($1::text[]) and ${FIXTURE_WORKSPACE_ROW}`,
        [active],
      ),
    ),
  );
}

beforeAll(async () => {
  const url = process.env.API_TEST_DATABASE_URL;
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await quiesceFixtureQueues(client);
  } finally {
    await client.end();
  }
});
