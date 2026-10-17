import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { AuditScheduler, schedulerSettings } from '../src/workers/audit-scheduler.ts';
import { nextRunAfter } from '../src/audits/schedule-cadence.ts';
import { createSchedule, updateSchedule } from '../src/audits/schedules.ts';
import { scheduleCreate } from '../src/audits/schedule-inputs.ts';
import { categoryByName, newProduct, addMembership } from '../src/commerce/catalog-store.ts';
import { record } from '../src/db/json.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  runtime = auditRuntime({}),
  settings = schedulerSettings({});
afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});
describe('durable audit occurrence planning', () => {
  it('finishes one admitted occurrence without preclaiming the remaining schedule', async () => {
    const t = await auditTenant(db, fixtures),
      at = new Date();
    const scope = { workspaceId: t.workspaceId, projectId: t.projectId };
    const schedules = await Promise.all(
      [0, 1].map(() =>
        createSchedule(
          db,
          scope,
          scheduleCreate.parse({
            prompt_set_id: t.setId,
            cadence: 'hourly',
            engines: ['chatgpt'],
            next_run_at: at.toISOString(),
          }),
        ),
      ),
    );
    let admissions = 0;
    const scheduler = new AuditScheduler(db, runtime, settings, { now: () => at });
    expect(await scheduler.runOnce(at, () => admissions++ === 0)).toBe(1);
    const rows = await db
      .selectFrom('audit_schedules')
      .select(['lease_owner', 'last_run_at'])
      .where(
        'id',
        'in',
        schedules.map((row) => row.id),
      )
      .execute();
    expect(rows.every((row) => row.lease_owner === null)).toBe(true);
    expect(rows.filter((row) => row.last_run_at !== null)).toHaveLength(1);
  });
  it('preserves local wall-clock cadence through DST, including ambiguous and missing local slots', () => {
    const schedule = {
      cadence: 'daily',
      timezone: 'America/New_York',
      interval_minutes: null,
      next_run_at: new Date('2026-03-07T14:00:00Z'),
    };
    expect(nextRunAfter(schedule, new Date('2026-03-08T13:00:00Z'))?.toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
    expect(
      nextRunAfter(
        { ...schedule, next_run_at: new Date('2026-10-31T05:30:00Z') },
        new Date('2026-11-01T04:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      nextRunAfter(
        { ...schedule, next_run_at: new Date('2026-03-07T07:30:00Z') },
        new Date('2026-03-08T06:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-03-08T07:30:00.000Z');
    expect(
      nextRunAfter(
        { ...schedule, cadence: 'every_n_minutes', interval_minutes: 15 },
        new Date('2026-03-08T13:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-03-08T13:15:00.000Z');
    expect(nextRunAfter({ ...schedule, cadence: 'one_time' }, new Date())).toBeNull();
    expect(() => nextRunAfter({ ...schedule, cadence: 'every_n_minutes' }, new Date())).toThrow(
      'positive interval',
    );
  });
  it('commits one scheduled Commerce audit and advancement under competing schedulers', async () => {
    const t = await auditTenant(db, fixtures),
      at = new Date(),
      scope = { workspaceId: t.workspaceId, projectId: t.projectId };
    const category = await categoryByName(db, scope, 'Running shoes'),
      product = await newProduct(db, scope, 'https://shop.example/product');
    await db
      .updateTable('commerce_products')
      .set({ name: 'Road shoe' })
      .where('id', '=', product.id)
      .execute();
    await addMembership(db, scope, product.id, category.id, null);
    await db
      .insertInto('commerce_prompt_targets')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        prompt_id: t.promptId,
        target_kind: 'category',
        target_id: category.id,
        template_version: 'fixture',
        approved_at: at,
        created_at: at,
      })
      .execute();
    const schedule = await createSchedule(
      db,
      scope,
      scheduleCreate.parse({
        prompt_set_id: t.setId,
        cadence: 'one_time',
        audit_scope: 'commerce',
        engines: ['chatgpt'],
        next_run_at: at.toISOString(),
      }),
    );
    const one = new AuditScheduler(db, runtime, settings, { owner: 'one', now: () => at }),
      two = new AuditScheduler(db, runtime, settings, { owner: 'two', now: () => at });
    const results = await Promise.all([one.runOnce(at), two.runOnce(at)]);
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    const audit = await db
      .selectFrom('audits')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('schedule_id', '=', schedule.id)
      .executeTakeFirstOrThrow();
    expect(audit).toMatchObject({
      audit_scope: 'commerce',
      trigger: 'scheduled',
      scheduled_for: at,
      status: 'queued',
    });
    expect(record(audit.configuration).commerce_measurement).toMatchObject({
      targets: [{ id: category.id, products: [{ id: product.id, name: 'Road shoe' }] }],
    });
    expect(
      await db
        .selectFrom('audit_schedules')
        .select(['enabled', 'next_run_at', 'lease_owner', 'last_run_at'])
        .where('id', '=', schedule.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ enabled: false, next_run_at: null, lease_owner: null, last_run_at: at });
    expect(await one.runOnce(at)).toBe(0);
  });
  it('recovers a committed occurrence and honors disable or expired-lease changes before planning', async () => {
    const t = await auditTenant(db, fixtures),
      at = new Date(),
      scope = { workspaceId: t.workspaceId, projectId: t.projectId };
    const schedule = await createSchedule(
      db,
      scope,
      scheduleCreate.parse({
        prompt_set_id: t.setId,
        cadence: 'hourly',
        engines: ['chatgpt'],
        next_run_at: at.toISOString(),
      }),
    );
    const [auditId] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
      { trigger: 'scheduled', scheduleId: schedule.id, scheduledFor: at },
      runtime,
      at,
    );
    const scheduler = new AuditScheduler(db, runtime, settings, { now: () => at });
    expect(await scheduler.runOnce(at)).toBe(1);
    expect(
      await db.selectFrom('audits').select('id').where('schedule_id', '=', schedule.id).execute(),
    ).toEqual([{ id: auditId }]);
    expect(
      (
        await db
          .selectFrom('audit_schedules')
          .select('next_run_at')
          .where('id', '=', schedule.id)
          .executeTakeFirstOrThrow()
      ).next_run_at,
    ).toEqual(new Date(at.getTime() + 3600000));
    await updateSchedule(db, scope, schedule.id, { next_run_at: at.toISOString() });
    const [claim] = await scheduler.claimDue(at);
    await updateSchedule(db, scope, schedule.id, { enabled: false });
    expect(await scheduler.planClaim(claim!, at)).toBe(false);
    await updateSchedule(db, scope, schedule.id, { enabled: true, next_run_at: at.toISOString() });
    const [expired] = await scheduler.claimDue(at);
    await db
      .updateTable('audit_schedules')
      .set({ lease_expires_at: new Date(0) })
      .where('id', '=', expired!.id)
      .execute();
    expect(await scheduler.planClaim(expired!, at)).toBe(false);
  });
  it('rolls back failed admission before recording bounded retry and disablement', async () => {
    const t = await auditTenant(db, fixtures),
      at = new Date(),
      scope = { workspaceId: t.workspaceId, projectId: t.projectId };
    await db
      .updateTable('provider_connections')
      .set({ active: false })
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    const schedule = await createSchedule(
      db,
      scope,
      scheduleCreate.parse({
        prompt_set_id: t.setId,
        cadence: 'hourly',
        engines: ['chatgpt'],
        next_run_at: at.toISOString(),
      }),
    );
    const scheduler = new AuditScheduler(
      db,
      runtime,
      { ...settings, max_consecutive_failures: 1 },
      { now: () => at },
    );
    expect(await scheduler.runOnce(at)).toBe(0);
    expect(
      await db.selectFrom('audits').select('id').where('schedule_id', '=', schedule.id).execute(),
    ).toEqual([]);
    expect(
      await db
        .selectFrom('audit_schedules')
        .select(['failure_count', 'enabled', 'last_error', 'lease_owner', 'next_run_at'])
        .where('id', '=', schedule.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({
      failure_count: 1,
      enabled: false,
      last_error: 'execution_credentials_unavailable', // the admission code the owner can act on
      lease_owner: null,
      next_run_at: new Date(at.getTime() + settings.failure_retry_seconds * 1000),
    });
  });
});
