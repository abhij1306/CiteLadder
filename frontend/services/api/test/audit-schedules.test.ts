import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import {
  canonicalTimezone,
  scheduleCreate,
  scheduleUpdate,
} from '../src/audits/schedule-inputs.ts';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  readSchedule,
  updateSchedule,
} from '../src/audits/schedules.ts';
import { promptSet } from './prompt-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

describe('audit schedule management', () => {
  const db = testDatabase();
  const fixtures = new VisibilityFixtures(db);
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });
  async function seed() {
    const tenant = await fixtures.tenant();
    const setId = await promptSet(db, tenant.projectId);
    const scope = { workspaceId: tenant.workspaceId, projectId: tenant.projectId };
    return { ...tenant, scope, setId };
  }
  const input = (setId: string, extra = {}) =>
    scheduleCreate.parse({
      prompt_set_id: setId,
      cadence: 'daily',
      engines: ['chatgpt'],
      ...extra,
    });

  it('persists a due commerce schedule, honors explicit instants, and retains omitted patch fields', async () => {
    const a = await seed();
    const due = await createSchedule(db, a.scope, input(a.setId, { audit_scope: 'commerce' }));
    expect(Date.parse(due.next_run_at!)).toBeLessThanOrEqual(Date.now());
    const pinned = await createSchedule(
      db,
      a.scope,
      input(a.setId, { next_run_at: '2026-10-01T12:00:00+05:30' }),
    );
    expect(pinned.next_run_at).toBe('2026-10-01T06:30:00.000Z');
    const updated = await updateSchedule(
      db,
      a.scope,
      due.id,
      scheduleUpdate.parse({ cadence: 'weekly' }),
    );
    expect(updated).toMatchObject({
      audit_scope: 'commerce',
      cadence: 'weekly',
      engines: ['chatgpt'],
      next_run_at: due.next_run_at,
    });
    expect((await listSchedules(db, a.scope)).map((item) => item.id)).toEqual([due.id, pinned.id]);
    await deleteSchedule(db, a.scope, pinned.id);
    await expect(readSchedule(db, a.scope, pinned.id)).rejects.toMatchObject({ status: 404 });
  });

  it('prevents cross-workspace and cross-project reads, patches, deletes, and prompt-set binding', async () => {
    const a = await seed();
    const b = await seed();
    const row = await createSchedule(db, a.scope, input(a.setId));
    await expect(createSchedule(db, a.scope, input(b.setId))).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      updateSchedule(db, a.scope, row.id, { prompt_set_id: b.setId }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await listSchedules(db, b.scope)).toEqual([]);
    for (const scope of [b.scope, { ...a.scope, projectId: b.projectId }]) {
      await expect(readSchedule(db, scope, row.id)).rejects.toMatchObject({ status: 404 });
      await expect(updateSchedule(db, scope, row.id, { enabled: false })).rejects.toMatchObject({
        status: 404,
      });
      await expect(deleteSchedule(db, scope, row.id)).rejects.toMatchObject({ status: 404 });
    }
    expect(await readSchedule(db, a.scope, row.id)).toMatchObject({
      prompt_set_id: a.setId,
      enabled: true,
    });
  });

  it('validates cadence against the stored interval and rolls back rejected patches', async () => {
    const a = await seed();
    const row = await createSchedule(db, a.scope, input(a.setId));
    await expect(
      updateSchedule(db, a.scope, row.id, { cadence: 'every_n_minutes' }),
    ).rejects.toMatchObject({ status: 422 });
    const timed = await updateSchedule(db, a.scope, row.id, {
      cadence: 'every_n_minutes',
      interval_minutes: 10,
    });
    await expect(updateSchedule(db, a.scope, row.id, { cadence: 'weekly' })).rejects.toMatchObject({
      status: 422,
    });
    expect(await readSchedule(db, a.scope, row.id)).toEqual(timed);
    expect(
      await updateSchedule(db, a.scope, row.id, { cadence: 'weekly', interval_minutes: null }),
    ).toMatchObject({ cadence: 'weekly', interval_minutes: null });
  });

  it('resume clears the failure streak and reason but keeps scheduler receipts and lease state', async () => {
    const a = await seed();
    const row = await createSchedule(db, a.scope, input(a.setId, { cadence: 'one_time' }));
    const lastRun = new Date('2026-09-30T12:00:00Z');
    await db
      .updateTable('audit_schedules')
      .set({
        enabled: false,
        next_run_at: null,
        last_run_at: lastRun,
        lease_owner: 'scheduler-owner',
        lease_expires_at: new Date(Date.now() + 60_000),
        failure_count: 2,
        last_error: 'bad_request',
      })
      .where('id', '=', row.id)
      .execute();
    const enabled = await updateSchedule(db, a.scope, row.id, { enabled: true });
    expect(enabled).toMatchObject({
      enabled: true,
      last_run_at: lastRun.toISOString(),
      failure_count: 0,
      last_error: '',
    });
    expect(enabled.next_run_at).not.toBeNull();
    const stored = await db
      .selectFrom('audit_schedules')
      .select('lease_owner')
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(stored.lease_owner).toBe('scheduler-owner');
  });

  it('serializes competing partial edits so they cannot persist an incoherent cadence', async () => {
    const a = await seed();
    const row = await createSchedule(db, a.scope, input(a.setId));
    const results = await Promise.allSettled([
      updateSchedule(db, a.scope, row.id, { cadence: 'every_n_minutes', interval_minutes: 10 }),
      updateSchedule(db, a.scope, row.id, { interval_minutes: null }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(await readSchedule(db, a.scope, row.id)).toMatchObject({
      cadence: 'every_n_minutes',
      interval_minutes: 10,
    });
  });

  it('waits for scheduler row locks and applies the patch to the committed scheduler state', async () => {
    const a = await seed();
    const row = await createSchedule(db, a.scope, input(a.setId));
    let pending: ReturnType<typeof updateSchedule> | undefined;
    const future = new Date('2026-10-02T00:00:00Z');
    await db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('audit_schedules')
        .select('id')
        .where('id', '=', row.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      pending = updateSchedule(db, a.scope, row.id, { enabled: true });
      await trx
        .updateTable('audit_schedules')
        .set({ next_run_at: future, lease_owner: 'scheduler-owner' })
        .where('id', '=', row.id)
        .execute();
    });
    expect(await pending).toMatchObject({ enabled: true, next_run_at: future.toISOString() });
  });

  it('gates HTTP mutation for viewers, permits their reads, and hides other projects', async () => {
    const a = await seed();
    const b = await seed();
    const viewer = await fixtures.user();
    await fixtures.member(a.workspaceId, viewer, 'viewer');
    const app = createApp(testConfig(), db);
    async function request(
      userId: string,
      method: string,
      projectId = a.projectId,
      suffix = '',
      body?: unknown,
    ) {
      return app.request(`/api/v1/projects/${projectId}/audit-schedules${suffix}`, {
        method,
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: userId, ver: 0 })}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    const created = await request(a.userId, 'POST', a.projectId, '', input(a.setId));
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string };
    expect((await request(viewer, 'GET')).status).toBe(200);
    expect((await request(viewer, 'POST', a.projectId, '', input(a.setId))).status).toBe(403);
    expect(
      (await request(viewer, 'PATCH', a.projectId, `/${row.id}`, { enabled: false })).status,
    ).toBe(403);
    expect((await request(viewer, 'DELETE', a.projectId, `/${row.id}`)).status).toBe(403);
    expect((await request(b.userId, 'GET', a.projectId, `/${row.id}`)).status).toBe(404);
    expect(
      (await request(a.userId, 'PATCH', a.projectId, `/${row.id}`, { cadence: null })).status,
    ).toBe(422);
    expect((await request(a.userId, 'DELETE', a.projectId, `/${row.id}`)).status).toBe(204);
  });
});

describe('schedule input decisions', () => {
  const base = { prompt_set_id: randomUUID(), cadence: 'daily', engines: ['chatgpt'] };
  it.each([
    { engines: ['chatgpt', 'chatgpt'] },
    { engines: [] },
    { engines: ['unknown'] },
    { timezone: 'not/a_zone' },
    { timezone: 'Factory' },
    { timezone: ' ' },
    { timezone: '+05:30' },
    { next_run_at: '2026-10-01T12:00:00' },
    { cadence: 'every_n_minutes' },
    { interval_minutes: 15 },
    { repetitions: 0 },
  ])('rejects invalid scheduling input %j', (patch) => {
    expect(scheduleCreate.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it.each([
    ['etc/utc', 'Etc/UTC'],
    ['utc', 'UTC'],
    ['Asia/KOLKATA', 'Asia/Kolkata'],
    ['not/a_zone', null],
  ])('stores timezone %s as %s', (value, stored) => {
    expect(canonicalTimezone(value)).toBe(stored);
  });
});
