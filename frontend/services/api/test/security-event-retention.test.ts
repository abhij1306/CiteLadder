import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { pruneSecurityEvents } from '../src/abuse/usage.ts';
import { testConfig, testDatabase } from './support.ts';

const db = testDatabase(testConfig());
const actor = randomUUID();
// The clock is fixed years in the past so the cutoff never reaches rows other
// test files write at the real time on the shared database. Only this file
// writes rows that old, so assertions read this run's rows alone and tolerate
// a crashed earlier run's leftovers being pruned alongside them.
const now = new Date('2020-01-31T00:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

async function record(occurredAt: Date) {
  const id = randomUUID();
  await db
    .insertInto('security_events')
    .values({
      id,
      event: 'api_key.create',
      actor_id: actor,
      workspace_id: null,
      target_id: null,
      occurred_at: occurredAt,
    })
    .execute();
  return id;
}
const remaining = async () =>
  (await db.selectFrom('security_events').select('id').where('actor_id', '=', actor).execute())
    .map((row) => row.id)
    .sort();

afterAll(async () => {
  await db.deleteFrom('security_events').where('actor_id', '=', actor).execute();
  await db.destroy();
});

it('deletes events older than the retention period in batches and keeps newer ones', async () => {
  await record(days(45));
  await record(days(40));
  await record(days(31));
  const recent = await record(days(29));
  const today = await record(now);

  // Three rows are past the cutoff, so one batch of two stops at two.
  expect(await pruneSecurityEvents(db, now, { retentionDays: 30, batch: 2 })).toBe(2);
  let pruned: number;
  do {
    pruned = await pruneSecurityEvents(db, now, { retentionDays: 30, batch: 2 });
  } while (pruned > 0);
  expect(await remaining()).toEqual([recent, today].sort());
});

it('deletes nothing once admission has closed', async () => {
  const old = await record(days(60));
  expect(await pruneSecurityEvents(db, now, { retentionDays: 30, batch: 10 }, () => false)).toBe(0);
  expect(await remaining()).toContain(old);
  await pruneSecurityEvents(db, now, { retentionDays: 30, batch: 10 });
  expect(await remaining()).not.toContain(old);
});
