/**
 * The combined transaction lock DAG (architecture.md) at the real PostgreSQL
 * boundary: Site Health controls, crawl admission and worker publication take
 * their locks in one order, so their interleavings wait instead of
 * deadlocking.
 */
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { poolOptions, type Database } from '../src/db/database.ts';
import type { DB } from '../src/generated/db-schema.ts';
import { lockRuntime } from '../src/site-health/frontier.ts';
import { admissionRuntime, createCrawl } from '../src/site-health/planner.ts';
import { rerunPage } from '../src/site-health/selection.ts';
import { canonicalIdentity } from '../src/site-health/url-identity.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';
import { testConfig, testDatabase } from './support.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const config = testConfig();
const db = testDatabase(config);
const fixtures = new SiteFixtures(db);

/** Every statement the logging connection runs, in order. */
const statements: string[] = [];
const logged: Database = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool(poolOptions(config)) }),
  log: (event) => {
    if (event.level === 'query') statements.push(event.query.sql);
  },
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await fixtures.cleanup();
  await logged.destroy();
  await db.destroy();
});

/** The combined lock DAG, Site Health prefix first: a transaction only moves rightward. */
const RANK = ['project', 'runtime', 'membership', 'crawl', 'profile'] as const;
const TABLE_LOCKS: Record<string, string> = {
  projects: 'project',
  workspace_site_health_runtime: 'runtime',
  monitored_site_urls: 'membership',
  site_crawls: 'crawl',
  site_health_profiles: 'profile',
};

/** The lock a statement acquires, or null for one that takes no lock of the DAG. */
function lockOf(statement: string) {
  const locking = /\bfor (?:update|no key update)\b/u.test(statement);
  const upsert = /^insert into "(workspace_site_health_runtime|site_health_profiles)"/u.exec(
    statement,
  );
  if (upsert) return TABLE_LOCKS[upsert[1]!]!;
  if (!locking) return null;
  const table = /\bfrom "(\w+)"/u.exec(statement)?.[1] ?? 'unknown';
  return TABLE_LOCKS[table] ?? table;
}

/**
 * Run `work` in one logged transaction and return the order in which it first
 * took each lock, asserting that order never steps back in the DAG.
 */
async function lockOrder(work: (trx: Database) => Promise<unknown>) {
  statements.length = 0;
  await logged.transaction().execute(work);
  const order: string[] = [];
  for (const statement of statements) {
    const lock = lockOf(statement);
    if (lock && !order.includes(lock)) order.push(lock);
  }
  const ranks = order.map((lock) => RANK.indexOf(lock as (typeof RANK)[number]));
  expect(ranks.every((rank, index) => rank >= 0 && rank >= (ranks[index - 1] ?? 0))).toBe(true);
  return order;
}

async function monitoredCrawl(limit: number) {
  const seed = await fixtures.crawl('running');
  vi.stubEnv('SITE_HEALTH_MONITORED_URL_LIMIT', String(limit));
  const page = await fixtures.page(seed, '/a', {}, { observed: true });
  await fixtures.monitor(seed, [page.id]);
  // The runtime row the worker and controls lock.
  await db.transaction().execute((trx) => admissionRuntime(trx, seed.workspaceId));
  return { seed, page };
}

async function backendPid(trx: Database) {
  const result = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
  return result.rows[0]!.pid;
}

/** Wait until another backend is queued behind a lock `pid` holds. */
async function blocksAnother(pid: number) {
  await vi.waitFor(
    async () => {
      const blocked = await sql<{ waiting: boolean }>`select exists (
        select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))
      ) as waiting`.execute(db);
      expect(blocked.rows[0]!.waiting).toBe(true);
    },
    { timeout: 5000, interval: 20 },
  );
}

/** A URL a discover commit admits into the seed's project. */
function foundUrl(seed: SiteSeed, path: string) {
  const identity = canonicalIdentity(path, seed.root);
  const now = new Date();
  return {
    id: randomUUID(),
    workspace_id: seed.workspaceId,
    project_id: seed.projectId,
    url_hash: identity.hash,
    normalized_url: identity.url,
    display_url: identity.url,
    host: 'example.test',
    item_kind: 'page',
    depth: 1,
    corpus_disposition: 'eligible',
    disposition_reason: '',
    disposition_version: 'fixture',
    first_seen_at: now,
    last_seen_at: now,
    first_seen_crawl_id: seed.crawlId,
    last_seen_crawl_id: seed.crawlId,
    latest_content_type: 'text/html',
    latest_source_kind: 'link',
    latest_title: '',
  };
}

describe('Site Health lock order', () => {
  it('lets a page rerun and a discover commit interleave without deadlock, then refuses the rerun', async () => {
    const { seed, page } = await monitoredCrawl(1);
    for (let round = 0; round < 5; round++) {
      // A discover commit locks the runtime first, then the crawl (lockSiteTask).
      const worker = await db.startTransaction().execute();
      let rerun: Promise<unknown> | undefined;
      try {
        await lockRuntime(worker, seed.workspaceId);
        rerun = db
          .transaction()
          .execute((trx) => rerunPage(trx, seed.workspaceId, seed.projectId, page.id));
        await blocksAnother(await backendPid(worker));
        // It writes a URL it found: the foreign key key-share locks the project row.
        await worker
          .insertInto('site_urls')
          .values(foundUrl(seed, `/found-${round}`))
          .execute();
        const crawl = await worker
          .selectFrom('site_crawls')
          .select('id')
          .where('id', '=', seed.crawlId)
          .forNoKeyUpdate()
          .executeTakeFirstOrThrow();
        expect(crawl.id).toBe(seed.crawlId);
        await worker.commit().execute();
        // It waited rather than deadlocked, then found the running crawl (SH-B4).
        await expect(rerun).rejects.toMatchObject({ status: 409, code: 'crawl_already_active' });
      } finally {
        if (!worker.isCommitted) await worker.rollback().execute();
        await rerun?.catch(() => undefined);
      }
    }
  });

  it('takes every admission and control lock in DAG order', async () => {
    const { seed, page } = await monitoredCrawl(2);
    const stopAll = () =>
      db
        .updateTable('site_crawls')
        .set({ status: 'cancelled' })
        .where('project_id', '=', seed.projectId)
        .execute();
    await stopAll();
    expect(
      await lockOrder((trx) => rerunPage(trx, seed.workspaceId, seed.projectId, page.id)),
    ).toEqual(['project', 'runtime', 'membership', 'crawl', 'profile']);
    await stopAll();
    expect(
      await lockOrder((trx) => createCrawl(trx, seed.workspaceId, { project_id: seed.projectId })),
    ).toEqual(['project', 'runtime', 'membership', 'profile']);
  });
});
