/**
 * Measurement markets against the real PostgreSQL schema: the markets
 * owner, one audit per market at admission, the estimate,
 * schedules, and the visibility market filter with workspace isolation.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { estimateAudit } from '../src/audits/estimate.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { createSchedule } from '../src/audits/schedules.ts';
import { AuditScheduler, schedulerSettings } from '../src/workers/audit-scheduler.ts';
import { scheduleCreate } from '../src/audits/schedule-inputs.ts';
import { record } from '../src/db/json.ts';
import { createConnection } from '../src/providers/connections.ts';
import { createConnectionInput } from '../src/providers/inputs.ts';
import { auditTenant, auditTestKey } from './audit-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new VisibilityFixtures(db);
const app = createApp(config, db);
const runtime = auditRuntime({});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function request(tenant: Tenant, path: string, method = 'GET', body?: unknown) {
  const response = await app.request(`/api/v1/projects/${tenant.projectId}${path}`, {
    method,
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: tenant.userId, ver: 0 })}`,
      'x-workspace-id': tenant.workspaceId,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A verified connection for each engine, so admission can route it. */
async function connect(
  tenant: Tenant,
  engines: ('gemini' | 'chatgpt_search' | 'gemini_consumer')[],
) {
  for (const engine of engines) {
    const connection = await createConnection(
      db,
      tenant.workspaceId,
      tenant.userId,
      createConnectionInput.parse(
        engine === 'gemini'
          ? {
              transport_provider: 'google',
              api_key: 'test-key',
              routes: [{ logical_engine: engine }],
            }
          : {
              transport_provider: 'dataforseo',
              api_login: 'test@example.com',
              api_password: 'test',
              routes: [{ logical_engine: engine }],
            },
      ),
      auditTestKey,
      runtime.providers,
    );
    await db
      .updateTable('provider_connections')
      .set({ last_test_status: 'ok' })
      .where('id', '=', connection.id)
      .execute();
  }
}

async function addGermany(tenant: Tenant): Promise<string> {
  const added = await request(tenant, '/markets', 'POST', {
    country_code: 'de',
    language_code: 'de',
  });
  expect(added.status).toBe(201);
  return added.body[1].id;
}

describe('project markets', () => {
  it('lists the project default first and adds markets', async () => {
    const tenant = await fixtures.tenant();
    await addGermany(tenant);
    const listed = await request(tenant, '/markets');
    expect(
      listed.body.map(({ id, ...market }: { id: string | null }) => [id === null, market]),
    ).toEqual([
      [
        true,
        {
          label: 'United States · English',
          country_code: 'US',
          language_code: 'en',
          is_default: true,
          created_at: null,
        },
      ],
      [
        false,
        {
          label: 'Germany · German',
          country_code: 'DE',
          language_code: 'de',
          is_default: false,
          created_at: expect.any(String),
        },
      ],
    ]);
  });

  it('refuses the default market and duplicates', async () => {
    const tenant = await fixtures.tenant();
    const fallback = await request(tenant, '/markets', 'POST', {
      country_code: 'US',
      language_code: 'en',
    });
    expect(fallback).toMatchObject({ status: 409, body: { error: { code: 'market_exists' } } });
    await addGermany(tenant);
    const duplicate = await request(tenant, '/markets', 'POST', {
      country_code: 'DE',
      language_code: 'de',
    });
    expect(duplicate).toMatchObject({ status: 409, body: { error: { code: 'market_exists' } } });
    const unknown = await request(tenant, '/markets', 'POST', {
      country_code: 'XX',
      language_code: 'de',
    });
    expect(unknown.status).toBe(422);
  });

  it("hides another workspace's markets", async () => {
    const owner = await fixtures.tenant();
    const marketId = await addGermany(owner);
    const outsider = await fixtures.tenant();
    const foreign = { ...outsider, projectId: owner.projectId };
    expect((await request(foreign, '/markets')).status).toBe(404);
    expect((await request(foreign, `/markets/${marketId}`, 'DELETE')).status).toBe(404);
    expect((await request(outsider, `/markets/${marketId}`, 'DELETE')).status).toBe(404);
    expect((await request(owner, '/markets')).body).toHaveLength(2);
  });

  it('drops a deleted market from schedules, falling back to the default', async () => {
    const tenant = await auditTenant(db, fixtures);
    const marketId = await addGermany(tenant);
    const scope = { workspaceId: tenant.workspaceId, projectId: tenant.projectId };
    const both = await createSchedule(
      db,
      scope,
      scheduleCreate.parse({
        prompt_set_id: tenant.setId,
        cadence: 'daily',
        engines: ['chatgpt'],
        market_ids: [null, marketId],
      }),
    );
    const only = await createSchedule(
      db,
      scope,
      scheduleCreate.parse({
        prompt_set_id: tenant.setId,
        cadence: 'daily',
        engines: ['chatgpt'],
        market_ids: [marketId],
      }),
    );
    expect((await request(tenant, `/markets/${marketId}`, 'DELETE')).status).toBe(204);
    const rows = await db
      .selectFrom('audit_schedules')
      .select(['id', 'market_ids'])
      .where('id', 'in', [both.id, only.id])
      .execute();
    expect(Object.fromEntries(rows.map((row) => [row.id, row.market_ids]))).toEqual({
      [both.id]: [null],
      [only.id]: [null],
    });
  });
});

describe('admission per market', () => {
  it('launches one audit per market, freezing each market and skipping engines it cannot measure', async () => {
    const tenant = await auditTenant(db, fixtures);
    await connect(tenant, ['gemini', 'chatgpt_search']);
    const marketId = await addGermany(tenant);
    const ids = await createAudits(
      db,
      tenant.workspaceId,
      auditInput.parse({
        project_id: tenant.projectId,
        prompt_set_id: tenant.setId,
        engines: ['chatgpt', 'gemini', 'chatgpt_search'],
        market_ids: [null, marketId],
      }),
      {},
      runtime,
    );
    expect(ids).toHaveLength(2);
    const audits = await db
      .selectFrom('audits')
      .select(['id', 'market_id', 'launch_id', 'configuration'])
      .where('id', 'in', ids)
      .execute();
    const byMarket = new Map(audits.map((audit) => [audit.market_id, audit]));
    const fallback = record(byMarket.get(null)?.configuration);
    const germany = record(byMarket.get(marketId)?.configuration);
    expect(new Set(audits.map((audit) => audit.launch_id)).size).toBe(1);
    expect([fallback.country_code, fallback.engines, fallback.not_applicable_engines]).toEqual([
      'US',
      ['chatgpt', 'gemini', 'chatgpt_search'],
      [],
    ]);
    expect([germany.country_code, germany.engines, germany.not_applicable_engines]).toEqual([
      'DE',
      ['chatgpt', 'chatgpt_search'],
      ['gemini'],
    ]);
    const scraper = await db
      .selectFrom('audit_tasks')
      .select(['audit_id', 'request_snapshot'])
      .where('audit_id', 'in', ids)
      .where('logical_engine', '=', 'chatgpt_search')
      .execute();
    expect(
      Object.fromEntries(
        scraper.map((task) => {
          const snapshot = record(task.request_snapshot);
          return [
            task.audit_id === byMarket.get(null)?.id ? 'US' : 'DE',
            [snapshot.location_code, snapshot.language_code],
          ];
        }),
      ),
    ).toEqual({ US: [2840, 'en'], DE: [2276, 'de'] });
  });

  it('launches every scheduled market for one occurrence, once', async () => {
    const tenant = await auditTenant(db, fixtures);
    const marketId = await addGermany(tenant);
    const at = new Date();
    const schedule = await createSchedule(
      db,
      { workspaceId: tenant.workspaceId, projectId: tenant.projectId },
      scheduleCreate.parse({
        prompt_set_id: tenant.setId,
        cadence: 'hourly',
        engines: ['chatgpt'],
        market_ids: [null, marketId],
        next_run_at: at.toISOString(),
      }),
    );
    const scheduler = new AuditScheduler(db, runtime, schedulerSettings({}), { now: () => at });
    await scheduler.runOnce(at);
    const audits = await db
      .selectFrom('audits')
      .select(['market_id', 'scheduled_for'])
      .where('schedule_id', '=', schedule.id)
      .execute();
    expect(audits.map((audit) => audit.market_id).sort()).toEqual([marketId, null].sort());
    expect(new Set(audits.map((audit) => audit.scheduled_for?.toISOString())).size).toBe(1);
  });

  it('refuses a market language a search surface does not list, before creating any audit', async () => {
    const tenant = await auditTenant(db, fixtures);
    await connect(tenant, ['chatgpt_search', 'gemini_consumer']);
    const japanChinese = (
      await request(tenant, '/markets', 'POST', { country_code: 'JP', language_code: 'zh' })
    ).body[1].id;
    const brazil = (
      await request(tenant, '/markets', 'POST', { country_code: 'BR', language_code: 'pt-BR' })
    ).body[2].id;
    const launch = (
      engines: ('chatgpt' | 'chatgpt_search' | 'gemini_consumer')[],
      market: string,
    ) =>
      createAudits(
        db,
        tenant.workspaceId,
        auditInput.parse({
          project_id: tenant.projectId,
          prompt_set_id: tenant.setId,
          engines,
          market_ids: [null, market],
        }),
        {},
        runtime,
      );
    await expect(launch(['chatgpt', 'chatgpt_search'], japanChinese)).rejects.toMatchObject({
      status: 422,
      code: 'market_unsupported',
      details: { engine: 'chatgpt_search', country_code: 'JP', language_code: 'zh' },
    });
    // Gemini's consumer surface lists no Portuguese.
    await expect(launch(['gemini_consumer'], brazil)).rejects.toMatchObject({
      status: 422,
      code: 'market_unsupported',
      details: { engine: 'gemini_consumer', country_code: 'BR', language_code: 'pt-BR' },
    });
    const created = await db
      .selectFrom('audits')
      .select('id')
      .where('project_id', '=', tenant.projectId)
      .execute();
    expect(created).toEqual([]);
  });

  it('measures a regional language variant in its primary language', async () => {
    const tenant = await auditTenant(db, fixtures);
    await connect(tenant, ['chatgpt_search']);
    const brazil = (
      await request(tenant, '/markets', 'POST', { country_code: 'BR', language_code: 'pt-BR' })
    ).body[1].id;
    const [audit] = await createAudits(
      db,
      tenant.workspaceId,
      auditInput.parse({
        project_id: tenant.projectId,
        prompt_set_id: tenant.setId,
        engines: ['chatgpt_search'],
        market_ids: [brazil],
      }),
      {},
      runtime,
    );
    const task = await db
      .selectFrom('audit_tasks')
      .select('request_snapshot')
      .where('audit_id', '=', audit)
      .executeTakeFirstOrThrow();
    const snapshot = record(task.request_snapshot);
    expect([snapshot.location_code, snapshot.language_code]).toEqual([2076, 'pt']);
  });

  it('estimates each engine over the markets it can measure', async () => {
    const tenant = await auditTenant(db, fixtures);
    const marketId = await addGermany(tenant);
    const estimate = await estimateAudit(
      db,
      tenant.workspaceId,
      {
        project_id: tenant.projectId,
        prompt_set_id: tenant.setId,
        prompt_ids: [],
        engines: ['chatgpt', 'gemini'],
        repetitions: 2,
        market_ids: [null, marketId],
      },
      runtime,
    );
    expect(
      estimate.engines.map((engine) => [
        engine.logical_engine,
        engine.market_count,
        engine.execution_count,
      ]),
    ).toEqual([
      ['chatgpt', 2, 4],
      ['gemini', 1, 2],
    ]);
    expect([estimate.market_count, estimate.execution_count]).toEqual([2, 6]);
  });
});

describe('visibility by market', () => {
  it('reads each market apart and reports a never-measured market as no run', async () => {
    const tenant = await fixtures.tenant();
    const germany = await addGermany(tenant);
    const metrics = {
      total_completed: 4,
      brand_mention_count: 1,
      brand_mention_rate: 0.25,
      owned_citation_rate: 0,
      competitor_mention_rate: {},
      share_of_voice: { mention_counts: { 'Acme Corp': 1 } },
      coverage: { requested: 4, failed: 0, not_run: 0 },
    };
    const run = async (marketId: string | null, mentions: number) => {
      const auditId = await fixtures.audit(tenant, { completedAt: new Date() });
      await db
        .updateTable('audits')
        .set({ market_id: marketId })
        .where('id', '=', auditId)
        .execute();
      await fixtures.metricSnapshot(tenant, auditId, {
        metrics: {
          ...metrics,
          brand_mention_count: mentions,
          brand_mention_rate: mentions / 4,
          share_of_voice: { mention_counts: { 'Acme Corp': mentions } },
          per_engine: {},
        },
      });
      return auditId;
    };
    const fallbackRun = await run(null, 1);
    const germanRun = await run(germany, 3);
    await request(tenant, '/markets', 'POST', { country_code: 'FR', language_code: 'fr' });

    expect((await request(tenant, '/visibility')).body.audit_id).toBe(fallbackRun);
    expect((await request(tenant, `/visibility?market=${germany}`)).body.audit_id).toBe(germanRun);

    const byMarket = await request(tenant, '/visibility/markets');
    expect(
      byMarket.body.markets.map((row: Record<string, unknown>) => [
        record(row.market).country_code,
        row.state,
        row.audit_id,
        row.mention_rate,
      ]),
    ).toEqual([
      ['US', 'measured', fallbackRun, 0.25],
      ['DE', 'measured', germanRun, 0.75],
      ['FR', 'no_run', null, null],
    ]);

    const outsider = await fixtures.tenant();
    expect(
      (await request({ ...outsider, projectId: tenant.projectId }, '/visibility/markets')).status,
    ).toBe(404);
  });
});
