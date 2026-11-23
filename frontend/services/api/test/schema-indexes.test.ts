import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import type { Database } from '../src/db/database.ts';
import type { DB } from '../src/generated/db-schema.ts';
import {
  AGENT_LANE,
  ANALYTICS_LANE,
  AUDIT_LANE,
  claimStatement,
  DISCOVERY_LANE,
  INTEGRATION_LANE,
  SITE_HEALTH_LANE,
} from '../src/queue/task-queue.ts';
import { expiredBatch } from '../src/referrals/retention.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
afterAll(async () => {
  await db.destroy();
});

describe('project deletion', () => {
  const highVolumeParents: (keyof DB)[] = [
    'raw_response_artifacts',
    'audit_tasks',
    'audit_prompt_snapshots',
    'audit_engine_snapshots',
    'site_fetch_artifacts',
    'site_page_analyses',
    'site_rule_evaluations',
    'site_crawl_tasks',
    'site_urls',
    'integration_metric_rows',
    'opportunities',
    'agent_output_suggestions',
  ];

  it('indexes every reference to a parent it removes row by row', async () => {
    const unindexed = await sql<{ reference: string }>`
      with refs as (
        select c.conname, c.conrelid, c.conrelid::regclass::text as child,
          array(select a.attname::text from unnest(c.conkey) k(attnum)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
        from pg_constraint c
        where c.contype = 'f'
          and c.confrelid::regclass::text = any(${highVolumeParents}::text[])
      ), index_columns as (
        select i.indrelid,
          array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                order by k.ord) as cols
        from pg_index i
      )
      select r.child || '.' || array_to_string(r.cols, ',') || ' (' || r.conname || ')' as reference
      from refs r
      where not exists (
        select 1 from index_columns l
        where l.indrelid = r.conrelid
          and ((l.cols[1:cardinality(r.cols)] @> r.cols and l.cols[1:cardinality(r.cols)] <@ r.cols)
            or (l.cols[1] = any(r.cols) and l.cols[1] not in ('workspace_id', 'project_id')))
      )
      order by reference`.execute(db);
    expect(unindexed.rows.map((row) => row.reference)).toEqual([]);
  });

  it('finds the rows each set-null reference clears through an index', async () => {
    const references = await sql<{ child: string; cols: string[] }>`
      select c.conrelid::regclass::text as child,
        array(select a.attname::text from unnest(c.conkey) k(attnum)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
      from pg_constraint c
      where c.contype = 'f' and c.confdeltype = 'n' and c.confrelid <> 'public.users'::regclass
        and c.conparentid = 0 -- a partition's copy is checked through its parent's
      order by 1, 2`.execute(db);
    const checked: string[] = [];
    const scanned: string[] = [];
    for (const { child, cols } of references.rows) {
      const reference = `${child}.${cols.join(',')}`;
      checked.push(reference);
      const lookup = sql.join(
        cols.map((col) => sql`${sql.ref(col)} = ${randomUUID()}::uuid`),
        sql` and `,
      );
      const scans = await indexScans((trx) =>
        sql`explain (format json) select 1 from ${sql.table(child)} where ${lookup}`.execute(trx),
      );
      const cleared = cols.filter((col) => col !== 'workspace_id' && col !== 'project_id');
      const served = scans.some(({ condition }) =>
        cleared.some((col) => condition.includes(`(${col} = `)),
      );
      if (!served) scanned.push(reference);
    }
    expect(checked).toContain('commerce_categories.workspace_id,project_id,parent_category_id');
    expect(scanned).toEqual([]);
  });
});

async function indexScans(explain: (trx: Database) => Promise<unknown>) {
  const plan = await db.transaction().execute(async (trx) => {
    await sql`set local enable_seqscan = off`.execute(trx);
    return explain(trx);
  });
  const scans: { index: string; condition: string }[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === 'object') {
      if ('Index Name' in node && typeof node['Index Name'] === 'string')
        scans.push({
          index: node['Index Name'],
          condition:
            'Index Cond' in node && typeof node['Index Cond'] === 'string'
              ? node['Index Cond']
              : '',
        });
      Object.values(node).forEach(visit);
    }
  };
  visit(plan);
  return scans;
}

async function indexesRead(explain: (trx: Database) => Promise<unknown>) {
  return (await indexScans(explain)).map(({ index }) => index);
}

describe('background reads', () => {
  it('pages expired referral events through the retention index', async () => {
    expect(
      await indexesRead((trx) => expiredBatch(trx, randomUUID(), new Date()).explain('json')),
    ).toContain('ix_referral_events_retention');
  });

  it.each([
    ANALYTICS_LANE,
    SITE_HEALTH_LANE,
    DISCOVERY_LANE,
    AGENT_LANE,
    INTEGRATION_LANE,
    AUDIT_LANE,
  ] as const)('claims $table work through its claimable-only index', async (lane) => {
    const plan = await indexesRead(async (trx) => {
      await sql`set local enable_sort = off`.execute(trx);
      return claimStatement(trx, lane, { now: new Date(), limit: 1 }).explain('json');
    });
    expect(plan).toContain(`ix_${lane.table}_claim`);
  });
});
