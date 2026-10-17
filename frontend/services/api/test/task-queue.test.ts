/**
 * The analytics queue against real PostgreSQL: claims by disjoint kind sets
 * never overlap, a workspace gets one task before any gets a second, and only
 * the lease owner may run or extend a claimed row.
 */
import { randomUUID } from 'node:crypto';

import { sql, type AliasNode, type OperationNode, type SelectQueryNode } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { claimStatement, TaskQueue } from '../src/queue/task-queue.ts';
import { Fixtures, testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
const queue = new TaskQueue(db, { leaseTtlSeconds: 120 });
const TS_KINDS = policy.analytics.ts_owned_task_kinds;
let workspaces: string[] = [];

async function task(workspaceId: string, kind: string, priority = 0): Promise<string> {
  const id = randomUUID();
  const now = new Date(Date.now() - 1000);
  await db
    .insertInto('analytics_tasks')
    .values({
      id,
      workspace_id: workspaceId,
      task_kind: kind,
      payload: {},
      idempotency_key: `queue-test:${id}`,
      status: 'queued',
      priority,
      randomized_position: 0,
      available_at: now,
      attempt_count: 0,
      max_attempts: 3,
      error_code: '',
      error_detail: '',
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}

beforeAll(async () => {
  const owner = await fixtures.user();
  workspaces = [
    await fixtures.joinedWorkspace(owner),
    await fixtures.joinedWorkspace(owner),
    await fixtures.joinedWorkspace(owner),
  ];
});

beforeEach(async () => {
  await db.deleteFrom('analytics_tasks').where('workspace_id', 'in', workspaces).execute();
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

/** Column names referenced by a node, not descending into subqueries. */
function referencedColumns(node: unknown, into = new Set<string>()): Set<string> {
  if (node === null || typeof node !== 'object') return into;
  const operation = node as OperationNode & Record<string, unknown>;
  if (operation.kind === 'SelectQueryNode') return into;
  if (operation.kind === 'ColumnNode') {
    into.add((operation.column as { name: string }).name);
  }
  for (const child of Object.values(operation)) {
    if (Array.isArray(child)) child.forEach((item) => referencedColumns(item, into));
    else referencedColumns(child, into);
  }
  return into;
}

describe('TaskQueue', () => {
  it('scopes seed claims and lease recovery to explicit task IDs and their workspace', async () => {
    const selected = await task(workspaces[0]!, TS_KINDS[0]!);
    const sibling = await task(workspaces[0]!, TS_KINDS[0]!);
    const foreign = await task(workspaces[1]!, TS_KINDS[0]!);
    const scope = { workspaceId: workspaces[0]!, taskIds: [selected, foreign] };
    expect(
      (await queue.claim({ owner: 'seed', kinds: TS_KINDS, scope })).map((row) => row.id),
    ).toEqual([selected]);
    expect(
      await queue.claim({ owner: 'empty', kinds: TS_KINDS, scope: { ...scope, taskIds: [] } }),
    ).toEqual([]);
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'running', lease_expires_at: new Date(0) })
      .where('id', 'in', [selected, sibling, foreign])
      .execute();
    const { recoverAnalyticsLeases } = await import('../src/queue/analytics-recovery.ts');
    expect(await recoverAnalyticsLeases(db, 10, scope)).toBe(1);
    expect(
      (
        await db
          .selectFrom('analytics_tasks')
          .select('status')
          .where('id', '=', selected)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('retry_wait');
    expect(
      (
        await db
          .selectFrom('analytics_tasks')
          .select('status')
          .where('id', 'in', [sibling, foreign])
          .execute()
      ).map((row) => row.status),
    ).toEqual(['running', 'running']);
  });
  it.each([-86400000, 86400000])(
    'keeps leases live with application clock skew %s',
    async (skew) => {
      const id = await task(workspaces[0]!, TS_KINDS[0]!);
      await db
        .updateTable('analytics_tasks')
        .set({ available_at: new Date(0) })
        .where('id', '=', id)
        .execute();
      const skewed = new TaskQueue(db, {
        leaseTtlSeconds: 120,
        now: () => new Date(Date.now() + skew),
      });
      const [claimed] = await skewed.claim({ owner: 'skewed', kinds: TS_KINDS });
      expect(await skewed.markRunning(claimed!.id, 'skewed')).toBe(true);
      expect(await skewed.heartbeat(claimed!.id, 'skewed', claimed!.workspace_id)).toBe(true);
      const expiry = await db
        .selectFrom('analytics_tasks')
        .select(
          sql<number>`extract(epoch from (lease_expires_at - clock_timestamp()))::float8`.as(
            'remaining',
          ),
        )
        .where('id', '=', claimed!.id)
        .executeTakeFirstOrThrow();
      expect(expiry.remaining).toBeGreaterThan(110);
      expect(expiry.remaining).toBeLessThanOrEqual(120);
      await db
        .updateTable('analytics_tasks')
        .set({ lease_expires_at: new Date(0) })
        .where('id', '=', claimed!.id)
        .execute();
      expect(await skewed.heartbeat(claimed!.id, 'skewed', claimed!.workspace_id)).toBe(false);
    },
  );
  it('re-checks eligibility on the locked relation, not only in the ranking', () => {
    const node = claimStatement(db, {
      now: new Date(),
      limit: 1,
      kinds: TS_KINDS,
    }).toOperationNode();
    expect(referencedColumns(node.where)).toEqual(new Set(['status', 'available_at']));
    const ranked = (node.joins![0]!.table as AliasNode).node as SelectQueryNode;
    expect(referencedColumns(ranked.where)).toEqual(
      new Set(['status', 'available_at', 'task_kind']),
    );
    expect(node.endModifiers?.map((item) => item.modifier)).toEqual(['ForUpdate', 'SkipLocked']);
  });

  it('never duplicates claims between concurrent workers', async () => {
    const created = new Map<string, string>();
    for (const [index, workspaceId] of workspaces.entries()) {
      for (let copy = 0; copy < 6; copy += 1) {
        for (const kind of TS_KINDS) {
          created.set(await task(workspaceId, kind, (index + copy) % 3), kind);
        }
      }
    }
    const drain = async (owner: string, kinds: readonly string[]) => {
      const seen: { id: string; kind: string }[] = [];
      for (;;) {
        const claimed = await queue.claim({ owner, kinds, limit: 3 });
        if (claimed.length === 0) return seen;
        seen.push(...claimed.map((row) => ({ id: row.id, kind: row.task_kind })));
      }
    };
    const results = await Promise.all([...[1, 2, 3, 4].map((n) => drain(`ts-${n}`, TS_KINDS))]);
    const tsClaims = results.flat();
    const all = tsClaims.map((claim) => claim.id);

    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(created.keys()));
    expect(tsClaims.every((claim) => TS_KINDS.includes(claim.kind))).toBe(true);
  });

  it('serves one task per workspace before any workspace gets a second', async () => {
    const [busy, quiet] = workspaces as [string, string];
    for (let index = 0; index < 4; index += 1) await task(busy, 'ingest_referrals', 5);
    await task(quiet, 'ingest_referrals', 0);

    const claimed = await queue.claim({ owner: 'fair', kinds: TS_KINDS, limit: 2 });

    expect(claimed.map((row) => row.workspace_id).sort()).toEqual([busy, quiet].sort());
    expect(claimed.every((row) => row.status === 'leased' && row.lease_owner === 'fair')).toBe(
      true,
    );
  });

  it('lets only the lease owner run and extend a claimed row', async () => {
    await task(workspaces[0]!, 'classify_referrals');
    const [claimed] = await queue.claim({ owner: 'holder', kinds: TS_KINDS });

    expect(await queue.markRunning(claimed!.id, 'intruder')).toBe(false);
    expect(await queue.heartbeat(claimed!.id, 'intruder', claimed!.workspace_id)).toBe(false);
    expect(await queue.heartbeat(claimed!.id, 'holder', workspaces[1]!)).toBe(false);
    expect(await queue.markRunning(claimed!.id, 'holder')).toBe(true);
    expect(await queue.markRunning(claimed!.id, 'holder')).toBe(false);
    expect(await queue.heartbeat(claimed!.id, 'holder', claimed!.workspace_id)).toBe(true);
  });

  it('skips rows that are not yet available or already terminal', async () => {
    const future = await task(workspaces[0]!, 'ingest_referrals');
    await db
      .updateTable('analytics_tasks')
      .set({ available_at: new Date(Date.now() + 60_000) })
      .where('id', '=', future)
      .execute();
    const done = await task(workspaces[1]!, 'ingest_referrals');
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'succeeded' })
      .where('id', '=', done)
      .execute();

    expect(await queue.claim({ owner: 'late', kinds: TS_KINDS })).toEqual([]);
  });
});
