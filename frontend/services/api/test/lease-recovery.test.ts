import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';

import type { Database } from '../src/db/database.ts';
import { reclaimExpiredLeases } from '../src/queue/recovery.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const at = new Date('2026-10-11T08:00:00Z');
const queuedAt = new Date('2026-10-11T07:00:00Z');
const scope = (seed: SiteSeed) =>
  sql<boolean>`workspace_id = ${seed.workspaceId} and crawl_id = ${seed.crawlId}`;
const reclaim = (seed: SiteSeed, charge: 0 | 1, database: Database = db) =>
  reclaimExpiredLeases(database, {
    table: 'site_crawl_tasks',
    charge,
    batchSize: 10,
    at,
    scope: scope(seed),
  });
const row = (id: string) =>
  db
    .selectFrom('site_crawl_tasks')
    .select([
      'status',
      'attempt_count',
      'lease_owner',
      'lease_expires_at',
      'heartbeat_at',
      'available_at',
      'completed_at',
      'error_code',
      'error_detail',
    ])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

async function expiredTask(attempts: number, error = { code: '', detail: '' }) {
  const seed = await fixtures.crawl('running');
  const id = await fixtures.task(seed, 'link_metrics', { maximum: 2 });
  await db
    .updateTable('site_crawl_tasks')
    .set({
      status: 'running',
      attempt_count: attempts,
      lease_owner: 'dead-worker',
      lease_expires_at: sql<Date>`clock_timestamp() - interval '1 second'`,
      heartbeat_at: sql<Date>`clock_timestamp() - interval '1 minute'`,
      available_at: queuedAt,
      error_code: error.code,
      error_detail: error.detail,
    })
    .where('id', '=', id)
    .execute();
  return { seed, id };
}

const released = { lease_owner: null, lease_expires_at: null, heartbeat_at: null };

describe('expired lease reclaim', () => {
  it.each([
    {
      name: 'a charged reclaim with attempts left retries now',
      charge: 1 as const,
      attempts: 0,
      expected: {
        status: 'retry_wait',
        attempt_count: 1,
        available_at: at,
        completed_at: null,
        error_code: '',
        error_detail: '',
      },
    },
    {
      name: 'a charged reclaim at the ceiling fails',
      charge: 1 as const,
      attempts: 1,
      expected: {
        status: 'failed',
        attempt_count: 2,
        available_at: queuedAt,
        completed_at: at,
        error_code: 'max_attempts_exceeded',
        error_detail: 'lease expired after max attempts exhausted',
      },
    },
    {
      name: 'an uncharged reclaim keeps the attempt its claim charged',
      charge: 0 as const,
      attempts: 1,
      expected: {
        status: 'retry_wait',
        attempt_count: 1,
        available_at: at,
        completed_at: null,
        error_code: '',
        error_detail: '',
      },
    },
    {
      name: 'an uncharged reclaim of an exhausted claim fails',
      charge: 0 as const,
      attempts: 2,
      expected: {
        status: 'failed',
        attempt_count: 2,
        available_at: queuedAt,
        completed_at: at,
        error_code: 'max_attempts_exceeded',
        error_detail: 'lease expired after max attempts exhausted',
      },
    },
  ])('$name', async ({ charge, attempts, expected }) => {
    const { seed, id } = await expiredTask(attempts);
    expect(await reclaim(seed, charge)).toEqual([
      {
        id,
        workspace_id: seed.workspaceId,
        status: expected.status,
        attempt_count: expected.attempt_count,
      },
    ]);
    expect(await row(id)).toEqual({ ...released, ...expected });
  });

  it('keeps the error an exhausted task already recorded', async () => {
    const { seed, id } = await expiredTask(1, { code: 'fetch_timeout', detail: 'Timed out' });
    await reclaim(seed, 1);
    expect(await row(id)).toMatchObject({
      status: 'failed',
      error_code: 'fetch_timeout',
      error_detail: 'Timed out',
    });
  });

  it('commits or rolls back with the caller’s transaction', async () => {
    const { seed, id } = await expiredTask(0);
    await expect(
      db.transaction().execute(async (trx) => {
        expect((await reclaim(seed, 1, trx)).map((task) => task.id)).toEqual([id]);
        throw new Error('parent settlement failed');
      }),
    ).rejects.toThrow('parent settlement failed');
    expect(await row(id)).toMatchObject({ status: 'running', attempt_count: 0 });
  });

  it('leaves live leases, locked rows and rows outside the scope', async () => {
    const { seed, id } = await expiredTask(0);
    const live = await fixtures.task(seed, 'link_metrics');
    await db
      .updateTable('site_crawl_tasks')
      .set({
        status: 'running',
        lease_owner: 'live-worker',
        lease_expires_at: sql<Date>`clock_timestamp() + interval '1 minute'`,
      })
      .where('id', '=', live)
      .execute();
    const other = await expiredTask(0);
    await db.transaction().execute(async (trx) => {
      // A heartbeat or publication holding the row: SKIP LOCKED passes over it.
      await trx
        .selectFrom('site_crawl_tasks')
        .select('id')
        .where('id', '=', id)
        .forUpdate()
        .execute();
      expect(await reclaim(seed, 1)).toEqual([]);
    });
    expect(await reclaim(seed, 1)).toEqual([
      {
        id,
        workspace_id: seed.workspaceId,
        status: 'retry_wait',
        attempt_count: 1,
      },
    ]);
    expect((await row(live)).status).toBe('running');
    expect((await row(other.id)).status).toBe('running');
  });

  it('reclaims the oldest expired leases first, one batch at a time', async () => {
    const seed = await fixtures.crawl('running');
    const ids = [await fixtures.task(seed), await fixtures.task(seed)];
    for (const [index, id] of ids.entries())
      await db
        .updateTable('site_crawl_tasks')
        .set({
          status: 'leased',
          lease_owner: 'dead-worker',
          lease_expires_at: sql<Date>`clock_timestamp() - ${index + 1} * interval '1 minute'`,
        })
        .where('id', '=', id)
        .execute();
    const batch = () =>
      reclaimExpiredLeases(db, {
        table: 'site_crawl_tasks',
        charge: 1,
        batchSize: 1,
        scope: scope(seed),
      });
    expect((await batch()).map((task) => task.id)).toEqual([ids[1]]);
    expect((await batch()).map((task) => task.id)).toEqual([ids[0]]);
    expect(await batch()).toEqual([]);
  });
});
