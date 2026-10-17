/**
 * Files share the local database in sequence, and unscoped workers claim and
 * backstop whatever is active there. Settle earlier files' active work so each
 * file starts from a quiescent queue rather than inheriting claimable rows or
 * running crawls that a backstop would finalize into new successors.
 *
 * Only fixture workspaces are settled: the same database serves the local app,
 * whose crawls and tasks a test run must never end.
 */
import pg from 'pg';
import { beforeAll } from 'vitest';
import { policy } from '../src/config.ts';
import { FIXTURE_WORKSPACE_ROW } from './fixture-workspace.ts';

const ACTIVE_CRAWL = ['draft', 'validating', 'queued', 'running'];

export async function quiesceFixtureQueues(client: pg.ClientBase) {
  const active = policy.task_queue.active;
  await client.query(
    `update site_crawls set status = 'failed', completed_at = coalesce(completed_at, now())
     where status = any($1::text[]) and ${FIXTURE_WORKSPACE_ROW}`,
    [ACTIVE_CRAWL],
  );
  // One client runs these in order; there is nothing to gain from awaiting each.
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
