import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActionSeed } from './action-support.ts';
import {
  actionId,
  actionPath,
  actionRoutes,
  otherRule,
  pageBody,
  promptRule,
} from './action-routes-support.ts';

const { db, seed, request, declare, eventCount } = actionRoutes();

describe('Action status decisions', () => {
  it('applies each legal status decision with one event, refuses an illegal one, and counts four statuses', async () => {
    const s = await seed();
    const list = `/api/v1/projects/${s.project_id}/actions`;
    const patch = async (status: string) => {
      const response = await request(s, actionPath(s), 'PATCH', { status });
      const body = (await response.json()) as { status?: string };
      return [response.status, response.ok ? body.status : null];
    };
    expect(await patch('in_progress')).toEqual([200, 'in_progress']);
    expect(await patch('open')).toEqual([422, null]);
    expect(await patch('dismissed')).toEqual([200, 'dismissed']);
    expect(await patch('open')).toEqual([200, 'open']);
    expect(await patch('dismissed')).toEqual([200, 'dismissed']);
    expect(await patch('in_progress')).toEqual([200, 'in_progress']);
    const events = await db
      .selectFrom('action_status_events')
      .select(['previous_status', 'next_status'])
      .where('workspace_id', '=', s.workspace_id)
      .execute();
    expect(events.map((e) => `${e.previous_status}>${e.next_status}`).sort()).toEqual([
      'dismissed>in_progress',
      'dismissed>open',
      'in_progress>dismissed',
      'open>dismissed',
      'open>in_progress',
    ]);
    expect((await pageBody(await request(s, list))).status_counts).toEqual({
      open: 2,
      in_progress: 1,
      done: 0,
      dismissed: 0,
    });
    expect((await declare(s, 'accepted')).status).toBe(201);
    expect(await patch('dismissed')).toEqual([422, null]);
    const done = await pageBody(await request(s, `${list}?status=done`));
    expect(done.items.map((row) => [row.id, row.status])).toEqual([[actionId(s), 'done']]);
    expect(done.status_counts).toEqual({ open: 2, in_progress: 0, done: 1, dismissed: 0 });
  });

  it('changes the named or filtered Actions in bulk, never another workspace’s', async () => {
    const s = await seed();
    const foreign = await seed();
    const path = `/api/v1/projects/${s.project_id}/actions/status`;
    const bulk = async (body: unknown, as = s) => {
      const response = await request(as, path, 'POST', body);
      return [response.status, response.ok ? await response.json() : null];
    };
    const statuses = async (t: ActionSeed) =>
      Object.fromEntries(
        (
          await db
            .selectFrom('actions')
            .select(['id', 'status'])
            .where('workspace_id', '=', t.workspace_id)
            .execute()
        ).map((row) => [row.id, row.status]),
      );
    const theirs = await statuses(foreign);

    const named = [actionId(s), actionId(s, otherRule), actionId(foreign)];
    expect(await bulk({ ids: named, to: 'dismissed' })).toEqual([
      200,
      { updated: 2, skipped: 1, truncated: false },
    ]);
    expect(await bulk({ filter: { status: 'open', grouping: 'seo' }, to: 'in_progress' })).toEqual([
      200,
      { updated: 0, skipped: 0, truncated: false },
    ]);
    expect(await bulk({ filter: { status: 'open' }, to: 'in_progress' })).toEqual([
      200,
      { updated: 1, skipped: 0, truncated: false },
    ]);
    expect(await bulk({ filter: { status: 'in_progress' }, to: 'open' })).toEqual([
      200,
      { updated: 0, skipped: 1, truncated: false },
    ]);
    expect(await statuses(s)).toEqual({
      [actionId(s)]: 'dismissed',
      [actionId(s, otherRule)]: 'dismissed',
      [actionId(s, promptRule)]: 'in_progress',
    });
    expect(await eventCount(s)).toBe(3);

    const raced = await Promise.all([
      bulk({ ids: [actionId(s), actionId(s, otherRule)], to: 'open' }),
      bulk({ ids: [actionId(s, otherRule), actionId(s)], to: 'open' }),
    ]);
    expect(raced.map(([, body]) => (body as { updated: number }).updated).sort()).toEqual([0, 2]);
    expect(await eventCount(s)).toBe(5);

    expect((await bulk({ ids: [actionId(s)], filter: { status: 'open' }, to: 'open' }))[0]).toBe(
      422,
    );
    const many = Array.from({ length: 101 }, () => randomUUID());
    expect((await bulk({ ids: many, to: 'dismissed' }))[0]).toBe(422);
    expect((await bulk({ ids: [actionId(s)], to: 'open' }, foreign))[0]).toBe(404);
    expect((await bulk({ filter: { status: 'dismissed' }, to: 'open' }, foreign))[0]).toBe(404);
    expect(await statuses(foreign)).toEqual(theirs);
    expect(await eventCount(foreign)).toBe(0);
    expect((await statuses(s))[actionId(s)]).toBe('open');
  });
});
