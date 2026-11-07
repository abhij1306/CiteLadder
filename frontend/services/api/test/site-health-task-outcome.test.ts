import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { failedAs, taskOutcome } from '../src/site-health/task-outcome.ts';
import { testConfig, testDatabase } from './support.ts';
import { SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const db = testDatabase(testConfig());
const fixtures = new SiteFixtures(db);

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

/** A failed discover task with `errorCode`, whose one fetch answered `status`. */
async function failed(seed: SiteSeed, errorCode: string, status: number | null) {
  const id = await fixtures.task(seed, 'discover');
  await db
    .updateTable('site_crawl_tasks')
    .set({ status: 'failed', error_code: errorCode })
    .where('id', '=', id)
    .execute();
  if (status !== null)
    await db
      .insertInto('site_fetch_attempts')
      .values({
        id: randomUUID(),
        task_id: id,
        crawl_id: seed.crawlId,
        workspace_id: seed.workspaceId,
        attempt_number: 1,
        request_ordinal: 0,
        method: 'GET',
        target_host: 'example.test',
        outcome: 'error',
        error_code: errorCode,
        status_code: status,
        latency_ms: 10,
        wire_bytes: null,
        decoded_bytes: null,
        acquisition_transport: 'recorded',
        acquisition_rung: null,
        acquisition_trigger: 'fixture',
        impersonation_profile: '',
        acquisition_options: null,
        acquisition_policy_version: 'fixture',
        artifact_id: null,
        created_at: new Date(),
      })
      .execute();
  return id;
}

const CASES = {
  robots: ['robots_denied', null],
  admission: ['url_admission_rejected', null],
  pdf: ['unsupported_content_type', 200],
  bot: ['bot_blocked', 403],
  // A code category wins over the fetch's status.
  botOnMissingPage: ['bot_blocked', 404],
  missing: ['http_4xx', 404],
  removed: ['http_4xx', 410],
  forbidden: ['http_4xx', 403],
  timeout: ['timeout', null],
} as const satisfies Record<string, readonly [string, number | null]>;

const EXPECTED = {
  robots: 'excluded',
  admission: 'excluded',
  pdf: 'not_page',
  bot: 'blocked',
  botOnMissingPage: 'blocked',
  missing: 'gone',
  removed: 'gone',
  forbidden: 'error',
  timeout: 'error',
};

describe('a failed Site Health task', () => {
  it('falls in one category, the same in TypeScript and in SQL', async () => {
    const seed = await fixtures.crawl('running');
    const ids = new Map<string, string>();
    for (const [label, [code, status]] of Object.entries(CASES))
      ids.set(await failed(seed, code, status), label);

    const rows = await db
      .selectFrom('site_crawl_tasks')
      .select([
        'id',
        failedAs('site_crawl_tasks', ['excluded']).as('excluded'),
        failedAs('site_crawl_tasks', ['not_page']).as('not_page'),
        failedAs('site_crawl_tasks', ['blocked']).as('blocked'),
        failedAs('site_crawl_tasks', ['gone']).as('gone'),
      ])
      .where('workspace_id', '=', seed.workspaceId)
      .where('crawl_id', '=', seed.crawlId)
      .execute();
    const inSql = Object.fromEntries(
      rows.map((row) => {
        const { id, ...categories } = row;
        const matched = Object.entries(categories).filter(([, hit]) => hit);
        return [ids.get(id)!, matched.length ? matched.map(([name]) => name).join('+') : 'error'];
      }),
    );
    const inTs = Object.fromEntries(
      Object.entries(CASES).map(([label, [errorCode, statusCode]]) => [
        label,
        taskOutcome({ errorCode, statusCode }),
      ]),
    );

    expect(inSql).toEqual(EXPECTED);
    expect(inTs).toEqual(EXPECTED);
  });

  it('matches any of several categories in one predicate', async () => {
    const seed = await fixtures.crawl('running');
    const labels = new Map<string, string>();
    for (const [label, [code, status]] of Object.entries(CASES))
      labels.set(await failed(seed, code, status), label);

    const expected = await db
      .selectFrom('site_crawl_tasks')
      .select('id')
      .where('workspace_id', '=', seed.workspaceId)
      .where('crawl_id', '=', seed.crawlId)
      .where(failedAs('site_crawl_tasks', ['excluded', 'not_page', 'gone']))
      .execute();

    expect(expected.map((row) => labels.get(row.id)).toSorted()).toEqual([
      'admission',
      'missing',
      'pdf',
      'removed',
      'robots',
    ]);
  });
});
