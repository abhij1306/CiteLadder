/**
 * Coalesced-successor enqueue against real PostgreSQL: concurrent requests
 * for one refresh leave one queued row with the earliest deadline, queued
 * work absorbs merged payloads, and leased work gets a queued successor.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { strings } from '../src/db/json.ts';
import { enqueueCoalesced } from '../src/queue/enqueue.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
// A kind no production worker drains, so no claim takes these rows mid-test.
const KIND = 'coalesce_probe';
const NOW = new Date('2026-11-06T10:00:00.000Z');

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function rows(projectId: string) {
  return db
    .selectFrom('analytics_tasks')
    .select(['status', 'available_at', 'payload'])
    .where('project_id', '=', projectId)
    .where('task_kind', '=', KIND)
    .orderBy('created_at')
    .orderBy('available_at')
    .execute();
}

describe('enqueueCoalesced', () => {
  it('leaves one queued row with the earliest deadline when two transactions request at once', async () => {
    const { workspaceId, projectId } = await fixtures.tenant();
    const request = (delaySeconds: number) =>
      db.transaction().execute(async (trx) => {
        await enqueueCoalesced(trx, { workspaceId, projectId, kind: KIND, delaySeconds, now: NOW });
        // Hold the transaction open so the other request overlaps it.
        await sleep(150);
      });

    await Promise.all([request(60), request(10)]);

    expect(await rows(projectId)).toEqual([
      { status: 'queued', available_at: new Date('2026-11-06T10:00:10.000Z'), payload: {} },
    ]);
  });

  it('merges into queued work and gives leased work a queued successor', async () => {
    const { workspaceId, projectId } = await fixtures.tenant();
    const request = (day: string) =>
      enqueueCoalesced(db, {
        workspaceId,
        projectId,
        kind: KIND,
        payload: { days: [day] },
        merge: (queued) => ({ days: [...strings(queued.days), day] }),
        delaySeconds: 30,
        now: NOW,
      });

    const first = await request('2026-11-04');
    await request('2026-11-05');
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'leased' })
      .where('id', '=', first!)
      .execute();
    await request('2026-11-06');

    expect(await rows(projectId)).toEqual([
      {
        status: 'leased',
        available_at: new Date('2026-11-06T10:00:30.000Z'),
        payload: { days: ['2026-11-04', '2026-11-05'] },
      },
      {
        status: 'queued',
        available_at: new Date('2026-11-06T10:00:30.000Z'),
        payload: { days: ['2026-11-06'] },
      },
    ]);
  });
});
