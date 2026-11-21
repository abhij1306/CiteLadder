import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { timeOrderedId } from '../src/db/ids.ts';
import { recordCrawlEvent } from '../src/site-health/site-task.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { asOwner, testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function crawlWithId(id: string) {
  const seed = await fixtures.crawl();
  await sql`insert into site_crawls
    select (jsonb_populate_record(null::site_crawls, to_jsonb(c) || jsonb_build_object('id', ${id}::uuid))).*
    from site_crawls c where c.id = ${seed.crawlId}`.execute(db);
  return db.selectFrom('site_crawls').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('evidence partitions', () => {
  it("files a crawl's events under its crawl month, and an older random id under the default", async () => {
    const monthly = await crawlWithId(timeOrderedId());
    const legacy = await crawlWithId(`f${randomUUID().slice(1)}`);
    for (const crawl of [monthly, legacy]) await recordCrawlEvent(db, crawl, 'test', 'm', {});
    const homes = await sql<{ crawl_id: string; home: string }>`
      select crawl_id, tableoid::regclass::text as home from site_crawl_events
      where crawl_id in (${monthly.id}, ${legacy.id})`.execute(db);
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    expect(Object.fromEntries(homes.rows.map((row) => [row.crawl_id, row.home]))).toEqual({
      [monthly.id]: `site_crawl_events_p${month}`,
      [legacy.id]: 'site_crawl_events_default',
    });
  });

  it('adds a month only while the default partition holds none of its range', async () => {
    const far = await asOwner(async (owner) => {
      const { rows } = await sql<{ id: string }>`
        select public.site_evidence_month_bound('2040-01-01') as id`.execute(owner);
      return `${rows[0]!.id.slice(0, 14)}${randomUUID().slice(14)}`;
    });
    await recordCrawlEvent(db, await crawlWithId(far), 'test', 'm', {});
    const outcomes = await asOwner(async (owner) => {
      const { rows } = await sql<{ far: string; current: string }>`
        select public.site_evidence_month_partition('site_crawl_events', '2040-01-15') as far,
          public.site_evidence_month_partition('site_crawl_events',
            (now() at time zone 'UTC')::date) as current`.execute(owner);
      return rows[0];
    });
    expect(outcomes).toEqual({ far: 'overlaps_default', current: 'exists' });
  });

  it('creates a month with its own workspace/crawl statistics', async () => {
    let created: unknown;
    await asOwner((owner) =>
      owner
        .transaction()
        .execute(async (trx) => {
          const outcome = await sql<{ outcome: string }>`
            select public.site_evidence_month_partition('site_issues', '2041-03-09') as outcome
          `.execute(trx);
          const facts = await sql<{ stats: string[] }>`
            select array(select stxname::text from pg_statistic_ext
                where stxrelid = 'public.site_issues_p2041_03'::regclass) as stats
          `.execute(trx);
          created = { ...outcome.rows[0], ...facts.rows[0] };
          throw new Error('rollback');
        })
        .catch(() => undefined),
    );
    expect(created).toEqual({
      outcome: 'created',
      stats: ['st_site_issues_p2041_03_workspace_crawl'],
    });
  });
});
