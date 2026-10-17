import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntegrationClient } from '../src/integrations/client.ts';
import { IntegrationError } from '../src/integrations/client.ts';
import { integrationPolicy, integrationSettings } from '../src/integrations/config.ts';
import { IntegrationWorker } from '../src/workers/integration-worker.ts';
import { selectedPartition } from '../src/integrations/partitions.ts';
import { recoverIntegrationLeases } from '../src/queue/recovery.ts';
import { referralEventFields } from '../src/referrals/events.ts';
import { seedProject } from './referral-fixtures.ts';
import { Fixtures, testDatabase } from './support.ts';
import { setLogSink } from '../src/logging.ts';
import { crawlLogs } from '../src/config/crawl-logs.ts';
import { policy } from '../src/config.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
const settings = { ...integrationSettings({}), sync_page_size: 2 };
let ownerId: string;

beforeAll(async () => {
  ownerId = await fixtures.user();
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

/** A worker held to one seeded run. */
function runWorker(
  run: { workspaceId: string; runId: string },
  client: Pick<IntegrationClient, 'page'>,
  workerSettings: typeof settings = settings,
) {
  return new IntegrationWorker(db, client, workerSettings, async () => 'recorded-token', {
    workspaceId: run.workspaceId,
    runId: run.runId,
  });
}

async function seedRun(provider: 'gsc' | 'ga4' | 'bing' = 'gsc') {
  const workspaceId = await fixtures.joinedWorkspace(ownerId);
  const projectId = await seedProject(db, workspaceId);
  const grantId = randomUUID();
  const connectionId = randomUUID();
  const mappingId = randomUUID();
  const runId = randomUUID();
  const now = new Date();
  await db
    .insertInto('integration_oauth_grants')
    .values({
      id: grantId,
      workspace_id: workspaceId,
      transport: provider === 'bing' ? 'microsoft_oauth' : 'google_oauth',
      access_token_encrypted: 'recorded-access-token',
      refresh_token_encrypted: 'recorded-refresh-token',
      token_expires_at: new Date(Date.now() + 3_600_000),
      token_revision: 1,
      refresh_claim_id: null,
      refresh_claim_expires_at: null,
      granted_scopes: JSON.stringify(['https://www.googleapis.com/auth/webmasters.readonly']),
      status: 'connected',
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('integration_connections')
    .values({
      id: connectionId,
      workspace_id: workspaceId,
      grant_id: grantId,
      provider,
      label: 'Recorded Search Console',
      account_ref: 'https://example.test',
      dataset_capabilities: JSON.stringify({}),
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('integration_property_mappings')
    .values({
      id: mappingId,
      workspace_id: workspaceId,
      connection_id: connectionId,
      provider,
      property_ref: provider === 'ga4' ? '123456789' : 'https://example.test',
      project_id: projectId,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('integration_sync_runs')
    .values({
      id: runId,
      workspace_id: workspaceId,
      connection_id: connectionId,
      mapping_id: mappingId,
      property_ref: provider === 'ga4' ? '123456789' : 'https://example.test',
      project_id: projectId,
      sync_kind: 'on_demand',
      window_start: new Date('2026-07-20T00:00:00Z'),
      window_end: new Date('2026-07-21T00:00:00Z'),
      resync_seq: 1,
      idempotency_key: `sync-test:${runId}`,
      status: 'queued',
      priority: 0,
      randomized_position: 0,
      available_at: now,
      attempt_count: 0,
      max_attempts: 4,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      error_code: '',
      error_detail: '',
      created_at: now,
      updated_at: now,
      completed_at: null,
    })
    .execute();

  return { workspaceId, projectId, grantId, connectionId, mappingId, runId };
}

describe('integration worker paging and resume', () => {
  it.each([
    // Stopped before it had one provider request timeout: admitted late, refunded.
    { timeout: settings.sync_request_timeout_seconds, attempts: 0 },
    // Had the full timeout and committed nothing: the attempt counts.
    { timeout: 0.000001, attempts: 1 },
  ])(
    'releases an interrupted sync for retry without claiming another run (timeout $timeout s)',
    async ({ timeout, attempts }) => {
      const selected = await seedRun();
      const other = await seedRun();
      try {
        const controller = new AbortController();
        const client: Pick<IntegrationClient, 'page'> = {
          page: async () => {
            controller.abort();
            throw new Error('Interrupted transport');
          },
        };
        const worker = runWorker(selected, client, {
          ...settings,
          sync_request_timeout_seconds: timeout,
        });
        await worker.runOnce(controller.signal);
        expect(await worker.runOnce(controller.signal)).toBe(false);
        const rows = await db
          .selectFrom('integration_sync_runs')
          .selectAll()
          .where('id', 'in', [selected.runId, other.runId])
          .execute();
        // A deadline stop is not a provider failure: the run is released for the next claim.
        expect(rows.find((row) => row.id === selected.runId)).toMatchObject({
          status: 'queued',
          attempt_count: attempts,
          lease_owner: null,
        });
        expect(rows.find((row) => row.id === other.runId)).toMatchObject({
          status: 'queued',
          attempt_count: 0,
        });
      } finally {
        await db
          .deleteFrom('workspaces')
          .where('id', 'in', [selected.workspaceId, other.workspaceId])
          .execute();
      }
    },
  );
  it('refunds a deadline stop that committed a page, so long imports are not written off', async () => {
    const { runId, workspaceId } = await seedRun();
    try {
      const controller = new AbortController();
      let calls = 0;
      const client: Pick<IntegrationClient, 'page'> = {
        async page() {
          calls += 1;
          if (calls > 1) controller.abort();
          const rows = [
            { keys: ['2026-07-20'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
            { keys: ['2026-07-21'], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
          ];
          return { payload: { rows }, rawRowCount: rows.length };
        },
      };
      const run = await db
        .updateTable('integration_sync_runs')
        .set({ attempt_count: 3 })
        .where('id', '=', runId)
        .returning('max_attempts')
        .executeTakeFirstOrThrow();
      expect(run.max_attempts).toBe(4);
      await runWorker({ workspaceId, runId }, client).runOnce(controller.signal);
      // The fourth attempt reached the deadline after committing a page: it is
      // refunded, so the run stays claimable instead of exhausting its attempts.
      expect(
        await db
          .selectFrom('integration_sync_runs')
          .select(['status', 'attempt_count'])
          .where('id', '=', runId)
          .executeTakeFirstOrThrow(),
      ).toEqual({ status: 'queued', attempt_count: 3 });
      const worker = new IntegrationWorker(db, client, settings, async () => 'recorded-token');
      expect(await worker.nextDue()).not.toBeNull();
    } finally {
      await db.deleteFrom('workspaces').where('id', '=', workspaceId).execute();
    }
  });

  it('refreshes a refused token once, and a property 403 leaves the shared grant connected', async () => {
    const refreshed = await seedRun();
    const forbidden = await seedRun();
    try {
      const resolved: Array<string | undefined> = [];
      const resolver = async (
        _db: unknown,
        _grant: string,
        _workspace: string,
        _client?: unknown,
        rejected?: string,
      ) => {
        resolved.push(rejected);
        return rejected ? 'rotated-token' : 'stale-token';
      };
      const unauthorized: Pick<IntegrationClient, 'page'> = {
        async page(_provider, token) {
          if (token === 'stale-token')
            throw new IntegrationError('grant_auth_failed', 'HTTP 401', false, null, 401);
          return { payload: { rows: [] }, rawRowCount: 0 };
        },
      };
      await new IntegrationWorker(db, unauthorized, settings, resolver, {
        workspaceId: refreshed.workspaceId,
        runId: refreshed.runId,
      }).runOnce();
      expect(resolved).toContain('stale-token');
      const denied: Pick<IntegrationClient, 'page'> = {
        async page() {
          throw new IntegrationError('property_not_accessible', 'HTTP 403', false, null, 403);
        },
      };
      await new IntegrationWorker(db, denied, settings, async () => 'token', {
        workspaceId: forbidden.workspaceId,
        runId: forbidden.runId,
      }).runOnce();
      const runs = await db
        .selectFrom('integration_sync_runs')
        .select(['id', 'status', 'error_code'])
        .where('id', 'in', [refreshed.runId, forbidden.runId])
        .execute();
      expect(runs.find((run) => run.id === refreshed.runId)?.status).toBe('succeeded');
      expect(runs.find((run) => run.id === forbidden.runId)).toMatchObject({
        status: 'failed',
        error_code: 'property_not_accessible',
      });
      const grants = await db
        .selectFrom('integration_oauth_grants')
        .select('status')
        .where('id', 'in', [refreshed.grantId, forbidden.grantId])
        .execute();
      expect(grants.map((grant) => grant.status)).toEqual(['connected', 'connected']);
    } finally {
      await db
        .deleteFrom('workspaces')
        .where('id', 'in', [refreshed.workspaceId, forbidden.workspaceId])
        .execute();
    }
  });

  it('recovers only the selected seed run, leaving sibling and foreign leases untouched', async () => {
    const selected = await seedRun();
    const foreign = await seedRun();
    try {
      const original = await db
        .selectFrom('integration_sync_runs')
        .selectAll()
        .where('id', '=', selected.runId)
        .executeTakeFirstOrThrow();
      const sibling = randomUUID();
      await db
        .insertInto('integration_sync_runs')
        .values({
          ...original,
          id: sibling,
          window_start: new Date('2026-07-19'),
          resync_seq: 2,
          idempotency_key: `sync-test:${sibling}`,
        })
        .execute();
      await db
        .updateTable('integration_sync_runs')
        .set({
          status: 'running',
          lease_owner: 'dead',
          lease_expires_at: new Date(0),
          attempt_count: 1,
        })
        .where('id', 'in', [selected.runId, sibling, foreign.runId])
        .execute();
      const client: Pick<IntegrationClient, 'page'> = {
        page: async () => ({ payload: { rows: [] }, rawRowCount: 0 }),
      };
      const worker = runWorker(selected, client);
      expect(await worker.runOnce()).toBe(true);
      expect(
        (
          await db
            .selectFrom('integration_sync_runs')
            .select('status')
            .where('id', '=', selected.runId)
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe('succeeded');
      expect(
        await db
          .selectFrom('integration_sync_runs')
          .select(['status', 'attempt_count'])
          .where('id', 'in', [sibling, foreign.runId])
          .execute(),
      ).toEqual([
        { status: 'running', attempt_count: 1 },
        { status: 'running', attempt_count: 1 },
      ]);
    } finally {
      await db
        .deleteFrom('workspaces')
        .where('id', 'in', [selected.workspaceId, foreign.workspaceId])
        .execute();
    }
  });
  it('keeps metadata from the newest revision when an older sync finishes later', async () => {
    const run = await seedRun('ga4');
    const original = await db
      .selectFrom('integration_sync_runs')
      .selectAll()
      .where('id', '=', run.runId)
      .executeTakeFirstOrThrow();
    const newer = randomUUID();
    await db
      .insertInto('integration_sync_runs')
      .values({
        ...original,
        id: newer,
        idempotency_key: `sync-test:newer:${run.runId}`,
        window_start: new Date('2026-07-19T00:00:00Z'),
        resync_seq: 2,
        priority: 10,
      })
      .execute();
    let metadata = { timeZone: 'UTC', currencyCode: 'USD' };
    const client: Pick<IntegrationClient, 'page'> = {
      async page() {
        return { payload: { rows: [], metadata }, rawRowCount: 0 };
      },
    };
    // The newer revision (higher priority) first, then the older one finishes later.
    expect(await runWorker({ ...run, runId: newer }, client).runOnce()).toBe(true);
    metadata = { timeZone: 'Asia/Kolkata', currencyCode: 'INR' };
    expect(await runWorker(run, client).runOnce()).toBe(true);
    expect(
      await db
        .selectFrom('integration_property_mappings')
        .select(['reporting_timezone', 'currency_code'])
        .where('id', '=', run.mappingId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ reporting_timezone: 'UTC', currency_code: 'USD' });
    expect(
      await db
        .selectFrom('crawl_log_states')
        .select('reporting_timezone')
        .where('project_id', '=', run.projectId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ reporting_timezone: 'UTC' });
  });
  it('captures GA4 property metadata, session attribution and excluded-host counts on immutable extract pages', async () => {
    const run = await seedRun('ga4');
    const client: Pick<IntegrationClient, 'page'> = {
      async page(_provider, _token, _property, template, _start, _end, offset) {
        const rows =
          template.dataset === 'ga4_landing_daily' && offset === 0
            ? ['example.test', 'foreign.test'].map((host) => ({
                dimensionValues: ['/guide', 'chatgpt.com', 'referral', host, '20260720'].map(
                  (value) => ({ value }),
                ),
                metricValues: ['4', '2', '0'].map((value) => ({ value })),
              }))
            : [];
        return {
          payload: {
            rows,
            metadata: {
              timeZone: 'Asia/Kolkata',
              currencyCode: 'INR',
              subjectToThresholding: true,
              dataLossFromOtherRow: true,
              samplingMetadatas: [{ samplesReadCount: '50', samplingSpaceSize: '100' }],
            },
          },
          rawRowCount: rows.length,
        };
      },
    };
    const originalRetention = crawlLogs.retention_days;
    crawlLogs.retention_days = policy.referrals.retention_days + 30;
    try {
      await runWorker(run, client).runOnce();
    } finally {
      crawlLogs.retention_days = originalRetention;
    }
    const rollup = await db
      .selectFrom('analytics_tasks')
      .select('payload')
      .where('project_id', '=', run.projectId)
      .where('task_kind', '=', 'crawl_log_rollup_refresh')
      .executeTakeFirstOrThrow();
    expect(
      (rollup.payload as { reporting_dates: string[] }).reporting_dates.length,
    ).toBeGreaterThan(policy.referrals.retention_days);
    expect(
      await db
        .selectFrom('integration_property_mappings')
        .select(['reporting_timezone', 'currency_code'])
        .where('id', '=', run.mappingId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ reporting_timezone: 'Asia/Kolkata', currency_code: 'INR' });
    const artifacts = await db
      .selectFrom('integration_import_artifacts')
      .select(['extract_metadata', 'query_snapshot'])
      .where('sync_run_id', '=', run.runId)
      .where('dataset', '=', 'ga4_landing_daily')
      .execute();
    expect(
      artifacts.some(
        (a) => (a.extract_metadata as { excluded_host_rows: number }).excluded_host_rows === 1,
      ),
    ).toBe(true);
    expect(artifacts[0]?.extract_metadata).toMatchObject({
      analytics_quality: ['thresholding', 'other_row_loss', 'sampling'],
    });
    expect((artifacts[0]!.query_snapshot as { dimensions: string[] }).dimensions).toEqual([
      'landingPage',
      'sessionSource',
      'sessionMedium',
      'hostName',
      'date',
    ]);
  });
  it('publishes with a live database lease despite a skewed application clock', async () => {
    const run = await seedRun();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 86400000));
    try {
      const client = { page: async () => ({ payload: { rows: [] }, rawRowCount: 0 }) };
      expect(await runWorker(run, client).runOnce()).toBe(true);
      const result = await db
        .selectFrom('integration_sync_runs')
        .select('status')
        .where('id', '=', run.runId)
        .executeTakeFirstOrThrow();
      expect(result.status).toBe('succeeded');
    } finally {
      vi.useRealTimers();
    }
  });
  it('claims by priority and availability while concurrent workers never share a run', async () => {
    const low = await seedRun(),
      high = await seedRun(),
      other = await seedRun();
    const future = await seedRun();
    await db
      .updateTable('integration_sync_runs')
      .set({ priority: 10 })
      .where('id', '=', high.runId)
      .execute();
    await db
      .updateTable('integration_sync_runs')
      .set({ available_at: new Date(Date.now() + 3600000) })
      .where('id', '=', future.runId)
      .execute();
    const grants: string[] = [];
    const client = { page: vi.fn(async () => ({ payload: { rows: [] }, rawRowCount: 0 })) };
    // A token is resolved per page; record each claimed run's grant once.
    const token: ConstructorParameters<typeof IntegrationWorker>[3] = async (_db, grantId) => {
      if (!grants.includes(grantId)) grants.push(grantId);
      return 'recorded-token';
    };
    const workers = [
      new IntegrationWorker(db, client, settings, token),
      new IntegrationWorker(db, client, settings, token),
    ];
    await workers[0]!.runOnce();
    expect(grants).toEqual([high.grantId]);
    expect(await Promise.all(workers.map((worker) => worker.runOnce()))).toEqual([true, true]);
    expect(grants.slice(1).sort()).toEqual([low.grantId, other.grantId].sort());
    expect(await workers[0]!.runOnce()).toBe(false);
  });
  it('serves the least recently claimed workspace before a busier workspace’s higher priority', async () => {
    const busy = await seedRun();
    await seedRun();
    const backlog = randomUUID();
    const first = await db
      .selectFrom('integration_sync_runs')
      .selectAll()
      .where('id', '=', busy.runId)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('integration_sync_runs')
      .values({
        ...first,
        id: backlog,
        idempotency_key: `sync-test:${backlog}`,
        resync_seq: 2,
        window_start: new Date('2026-07-21T00:00:00Z'),
        window_end: new Date('2026-07-22T00:00:00Z'),
      })
      .execute();
    await db
      .updateTable('integration_sync_runs')
      .set({ priority: 10 })
      .where('id', 'in', [busy.runId, backlog])
      .execute();
    const claimed: string[] = [];
    const client = { page: vi.fn(async () => ({ payload: { rows: [] }, rawRowCount: 0 })) };
    // A token is resolved per page; record each claimed run once.
    let current: string | undefined;
    const worker = new IntegrationWorker(db, client, settings, async (_db, grantId) => {
      if (current === undefined) {
        current = grantId === busy.grantId ? 'busy' : 'quiet';
        claimed.push(current);
      }
      return 'recorded-token';
    });
    const next = async () => {
      current = undefined;
      return worker.runOnce();
    };
    while (await next());
    expect(claimed).toEqual(['busy', 'quiet', 'busy']);
  });

  it('heartbeats a live request but denies late publication after recovery takes its lease', async () => {
    const target = await seedRun();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const client = {
      page: vi.fn(async () => {
        entered();
        await gate;
        return { payload: { rows: [] }, rawRowCount: 0 };
      }),
    };
    const worker = runWorker(target, client, { ...settings, heartbeat_interval_seconds: 0.01 });
    const running = worker.runOnce();
    const row = () =>
      db
        .selectFrom('integration_sync_runs')
        .selectAll()
        .where('id', '=', target.runId)
        .executeTakeFirstOrThrow();
    try {
      await started;
      const initial = await row();
      await vi.waitFor(async () =>
        expect((await row()).lease_expires_at!.getTime()).toBeGreaterThan(
          initial.lease_expires_at!.getTime(),
        ),
      );
      // Scoped to this run: other suites' leases share the table.
      const scope = { workspaceId: target.workspaceId, runId: target.runId };
      expect(await recoverIntegrationLeases(db, undefined, scope)).toBe(0);
      // The live heartbeat may renew (and lock) the lease between expiring it and
      // recovering it; expire again until recovery wins, as it eventually must.
      await vi.waitFor(async () => {
        await db
          .updateTable('integration_sync_runs')
          .set({ lease_expires_at: new Date(Date.now() - 1000) })
          .where('id', '=', target.runId)
          .where('lease_owner', 'is not', null)
          .execute();
        expect(await recoverIntegrationLeases(db, undefined, scope)).toBe(1);
      });
    } finally {
      release();
      await running;
    }
    expect(await row()).toMatchObject({
      status: 'retry_wait',
      lease_owner: null,
      attempt_count: 1,
    });
    expect(
      await db
        .selectFrom('integration_import_artifacts')
        .select('id')
        .where('sync_run_id', '=', target.runId)
        .execute(),
    ).toEqual([]);
    // Keep this fixture out of later worker claims.
    await db
      .updateTable('integration_sync_runs')
      .set({ status: 'cancelled' })
      .where('id', '=', target.runId)
      .execute();
  });

  it('recovers crashed attempts without charging twice and never retries an exhausted run', async () => {
    const retry = await seedRun(),
      exhausted = await seedRun();
    await db
      .updateTable('integration_sync_runs')
      .set({
        status: 'running',
        lease_owner: 'dead-worker',
        lease_expires_at: new Date(Date.now() - 1000),
        attempt_count: 1,
        max_attempts: 2,
      })
      .where('id', 'in', [retry.runId, exhausted.runId])
      .execute();
    await db
      .updateTable('integration_sync_runs')
      .set({ attempt_count: 2 })
      .where('id', '=', exhausted.runId)
      .execute();
    const logs: string[] = [];
    const previousSink = setLogSink((line) => logs.push(line));
    let reclaimed: number[];
    try {
      reclaimed = await Promise.all([
        recoverIntegrationLeases(db, 1),
        recoverIntegrationLeases(db, 1),
      ]);
    } finally {
      setLogSink(previousSink);
    }
    expect(logs.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        event: 'queue_task_attempts_exhausted',
        queue: 'integration_sync_runs',
        task_id: exhausted.runId,
        workspace_id: exhausted.workspaceId,
        attempt_count: 2,
      }),
    );
    expect(reclaimed.reduce((a, b) => a + b, 0)).toBe(2);
    const terminal = await db
      .selectFrom('integration_sync_runs')
      .selectAll()
      .where('id', '=', exhausted.runId)
      .executeTakeFirstOrThrow();
    expect(terminal).toMatchObject({
      status: 'failed',
      attempt_count: 2,
      lease_owner: null,
      error_code: 'max_attempts_exceeded',
    });
    expect(terminal.completed_at).not.toBeNull();
    const client = { page: vi.fn(async () => ({ payload: { rows: [] }, rawRowCount: 0 })) };
    expect(await runWorker(retry, client).runOnce()).toBe(true);
    expect(
      await db
        .selectFrom('integration_sync_runs')
        .select(['status', 'attempt_count'])
        .where('id', '=', retry.runId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'succeeded', attempt_count: 2 });
    // Neither the settled nor the exhausted run is claimable again.
    expect(await runWorker(retry, client).runOnce()).toBe(false);
    expect(await runWorker(exhausted, client).runOnce()).toBe(false);
  });
  it.each([
    {
      value: { reason: 'recorded non-Error rejection' },
      expected: '{"reason":"recorded non-Error rejection"}',
    },
    { value: 23n, expected: 'Unserializable integration failure' },
  ])(
    'records a useful bounded detail for non-Error rejections: $expected',
    async ({ value, expected }) => {
      const target = await seedRun();
      await runWorker(target, { page: vi.fn().mockRejectedValue(value) }).runOnce();
      const run = await db
        .selectFrom('integration_sync_runs')
        .select(['status', 'error_detail'])
        .where('id', '=', target.runId)
        .executeTakeFirstOrThrow();
      expect(run).toMatchObject({ status: 'failed', error_detail: expected });
    },
  );
  it('rejects a mapping retired while a provider request is in flight', async () => {
    const run = await seedRun();
    const client: Pick<IntegrationClient, 'page'> = {
      async page() {
        await db
          .updateTable('integration_property_mappings')
          .set({ status: 'disabled' })
          .where('id', '=', run.mappingId)
          .execute();
        return { payload: { rows: [] }, rawRowCount: 0 };
      },
    };
    await runWorker(run, client).runOnce();
    const outcome = await db
      .selectFrom('integration_sync_runs')
      .select(['status', 'error_code'])
      .where('id', '=', run.runId)
      .executeTakeFirstOrThrow();
    expect(outcome).toEqual({ status: 'failed', error_code: 'unmapped_property' });
    expect(
      await db
        .selectFrom('integration_import_artifacts')
        .select('id')
        .where('sync_run_id', '=', run.runId)
        .execute(),
    ).toEqual([]);
  });

  it('resumes the next uncommitted page of a run whose snapshot records only startRow', async () => {
    const run = await seedRun();
    for (const offset of [0, 2]) {
      await db
        .insertInto('integration_import_artifacts')
        .values({
          id: randomUUID(),
          sync_run_id: run.runId,
          workspace_id: run.workspaceId,
          connection_id: run.connectionId,
          provider: 'gsc',
          dataset: 'gsc_page_daily',
          query_snapshot: JSON.stringify({ startRow: offset }),
          row_count: 2,
          payload: JSON.stringify({ rows: [] }),
          payload_hash: `offset-${offset}`,
          fetched_at: new Date(),
          created_at: new Date(),
        })
        .execute();
    }
    const offsets: number[] = [];
    const client: Pick<IntegrationClient, 'page'> = {
      async page(_provider, _token, _property, template, _start, _end, offset) {
        if (template.dataset === 'gsc_page_daily') offsets.push(offset);
        return { payload: { rows: [] }, rawRowCount: 0 };
      },
    };
    await runWorker(run, client).runOnce();
    expect(offsets).toEqual([4]);
    expect(
      (
        await db
          .selectFrom('integration_sync_runs')
          .select('status')
          .where('id', '=', run.runId)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('succeeded');
  });

  it('keeps the raw Bing report but derives only real dates inside its frozen window', async () => {
    const run = await seedRun('bing');
    const rows = ['2026-07-19', '2026-07-20', '2026-07-22', '2026-02-30'].map((date) => ({
      keys: ['example query', date],
      clicks: 3,
      impressions: 10,
    }));
    const client: Pick<IntegrationClient, 'page'> = {
      async page() {
        return { payload: { rows }, rawRowCount: rows.length };
      },
    };
    await runWorker(run, client).runOnce();
    const metrics = await db
      .selectFrom('integration_metric_rows as metric')
      .innerJoin(
        'integration_import_artifacts as artifact',
        'artifact.id',
        'metric.source_artifact_id',
      )
      .select('metric.dimension_key')
      .where('artifact.sync_run_id', '=', run.runId)
      .execute();
    expect(metrics.map((row) => row.dimension_key)).toEqual([
      'example query | 2026-07-20',
      'example query | 2026-07-20',
    ]);
    const artifacts = await db
      .selectFrom('integration_import_artifacts')
      .select('payload')
      .where('sync_run_id', '=', run.runId)
      .execute();
    expect(
      artifacts.every((artifact) => (artifact.payload as { rows: unknown[] }).rows.length === 4),
    ).toBe(true);
  });

  it('publishes a Bing run whose full-history report reaches outside the window', async () => {
    const run = await seedRun('bing');
    const rows = ['2026-05-01', '2026-07-20', '2026-07-21'].map((date) => ({
      keys: ['example query', date],
      clicks: 3,
      impressions: 10,
    }));
    const client: Pick<IntegrationClient, 'page'> = {
      async page() {
        return { payload: { rows }, rawRowCount: rows.length };
      },
    };
    await runWorker(run, client).runOnce();
    // Out-of-window days are not invalid rows, so the partition is complete and
    // the readers select it.
    const selected = await db
      .selectFrom('integration_metric_rows')
      .select('dimension_key')
      .where('project_id', '=', run.projectId)
      .where('dataset', '=', 'bing_query_daily')
      .where(selectedPartition())
      .orderBy('dimension_key')
      .execute();
    expect(selected.map((row) => row.dimension_key)).toEqual([
      'example query | 2026-07-20',
      'example query | 2026-07-21',
    ]);
  });

  it('falls back narrowly for GA4, reuses the capability, and produces consumable referral keys', async () => {
    const run = await seedRun('ga4');
    const requested: string[] = [];
    const client: Pick<IntegrationClient, 'page'> = {
      async page(_provider, _token, _property, template) {
        requested.push(template.dataset);
        if (template.dataset === 'ga4_item_source_medium_daily')
          throw new IntegrationError(
            'ga4_dimension_incompatible',
            'recorded incompatible dimensions',
          );
        const rows =
          template.dataset === 'ga4_source_medium_daily'
            ? [
                {
                  dimensionValues: [
                    { value: 'chatgpt.com' },
                    { value: 'referral' },
                    { value: '20260720' },
                  ],
                  metricValues: template.metrics.map(() => ({ value: '2' })),
                },
              ]
            : [];
        return { payload: { rows }, rawRowCount: rows.length };
      },
    };
    await runWorker(run, client).runOnce();
    const finished = await db
      .selectFrom('integration_sync_runs')
      .selectAll()
      .where('id', '=', run.runId)
      .executeTakeFirstOrThrow();
    expect(finished.status).toBe('succeeded');
    const successors = await db
      .selectFrom('analytics_tasks')
      .select('task_kind')
      .where('workspace_id', '=', finished.workspace_id)
      .where('project_id', '=', run.projectId)
      .execute();
    expect(successors.map((task) => task.task_kind)).toEqual(
      expect.arrayContaining(['ingest_referrals', 'traffic_snapshot_refresh']),
    );
    expect(requested.filter((dataset) => dataset.startsWith('ga4_item_'))).toEqual([
      'ga4_item_source_medium_daily',
      'ga4_item_channel_group_daily',
    ]);
    const metric = await db
      .selectFrom('integration_metric_rows')
      .select(['dataset', 'dimension_key'])
      .where('project_id', '=', run.projectId)
      .where('dataset', '=', 'ga4_source_medium_daily')
      .executeTakeFirstOrThrow();
    expect(referralEventFields({ ...metric, date: '2026-07-20' })?.utm_source).toBe('chatgpt.com');
    const connection = await db
      .selectFrom('integration_connections')
      .select('dataset_capabilities')
      .where('id', '=', run.connectionId)
      .executeTakeFirstOrThrow();
    expect(
      (connection.dataset_capabilities as Record<string, { selected_dataset: string }>)[
        integrationPolicy.ga4_capability_key
      ]?.selected_dataset,
    ).toBe('ga4_item_channel_group_daily');
    const second = randomUUID();
    await db
      .insertInto('integration_sync_runs')
      .values({
        ...finished,
        id: second,
        idempotency_key: `second:${run.runId}`,
        resync_seq: 2,
        status: 'queued',
        attempt_count: 0,
        completed_at: null,
      })
      .execute();
    requested.length = 0;
    await runWorker({ ...run, runId: second }, client).runOnce();
    expect(requested.filter((dataset) => dataset.startsWith('ga4_item_'))).toEqual([
      'ga4_item_channel_group_daily',
    ]);
  });

  it('does not turn an unrelated GA4 provider error into a fallback', async () => {
    const run = await seedRun('ga4');
    const requested: string[] = [];
    const client: Pick<IntegrationClient, 'page'> = {
      async page(_provider, _token, _property, template) {
        requested.push(template.dataset);
        if (template.dataset === 'ga4_item_source_medium_daily')
          throw new IntegrationError('provider_api_error', 'recorded provider failure');
        return { payload: { rows: [] }, rawRowCount: 0 };
      },
    };
    await runWorker(run, client).runOnce();
    expect(requested).not.toContain('ga4_item_channel_group_daily');
    expect(
      await db
        .selectFrom('integration_sync_runs')
        .select(['status', 'error_code'])
        .where('id', '=', run.runId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'failed', error_code: 'provider_api_error' });
  });

  it('does not dispatch a GA4 fallback after losing its real PostgreSQL lease', async () => {
    const run = await seedRun('ga4');
    const requested: string[] = [];
    const client: Pick<IntegrationClient, 'page'> = {
      async page(_provider, _token, _property, template) {
        requested.push(template.dataset);
        if (template.dataset === 'ga4_item_source_medium_daily') {
          await db
            .updateTable('integration_sync_runs')
            .set({ lease_owner: 'successor' })
            .where('id', '=', run.runId)
            .execute();
          await new Promise((resolve) => {
            setTimeout(resolve, 50);
          });
          throw new IntegrationError('ga4_dimension_incompatible', 'recorded incompatibility');
        }
        return { payload: { rows: [] }, rawRowCount: 0 };
      },
    };
    await runWorker(run, client, {
      ...settings,
      heartbeat_interval_seconds: 0.01,
    }).runOnce();
    expect(requested).not.toContain('ga4_item_channel_group_daily');
    expect(
      await db
        .selectFrom('integration_sync_runs')
        .select(['status', 'lease_owner'])
        .where('id', '=', run.runId)
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: 'running', lease_owner: 'successor' });
  });

  it('continues after a committed provider page when a later request fails', async () => {
    const recordedPage = async (name: string): Promise<Record<string, unknown>> =>
      JSON.parse(
        await readFile(new URL(`./fixtures/integrations/${name}`, import.meta.url), 'utf8'),
      ) as Record<string, unknown>;
    const pageOne = await recordedPage('gsc_search_analytics_page1.json');
    const pageTwo = await recordedPage('gsc_search_analytics_page2.json');
    const run = await seedRun();
    const firstDataset = Object.values(integrationPolicy.datasets).find(
      (item) => item.dataset === 'gsc_page_daily',
    );
    if (!firstDataset) throw new Error('GSC page dataset policy is missing');
    let interrupted = false;
    const offsets: number[] = [];
    const client: Pick<IntegrationClient, 'page'> = {
      async page(_provider, _token, _property, template, _start, _end, offset) {
        if (template.dataset !== firstDataset.dataset)
          return { payload: { rows: [] }, rawRowCount: 0 };
        offsets.push(offset);
        if (offset === 2 && !interrupted) {
          interrupted = true;
          throw new IntegrationError('provider_api_error', 'recorded page interruption', true);
        }
        const payload = offset === 0 ? pageOne : pageTwo;
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        return { payload, rawRowCount: rows.length };
      },
    };
    const worker = runWorker(run, client);

    expect(await worker.runOnce()).toBe(true);
    const firstAttempt = await db
      .selectFrom('integration_sync_runs')
      .select(['status', 'attempt_count'])
      .where('id', '=', run.runId)
      .executeTakeFirstOrThrow();
    expect(firstAttempt.status).toBe('retry_wait');
    expect(firstAttempt.attempt_count).toBe(1);
    const committed = await db
      .selectFrom('integration_import_artifacts')
      .select(['query_snapshot', 'row_count'])
      .where('sync_run_id', '=', run.runId)
      .where('dataset', '=', firstDataset.dataset)
      .executeTakeFirstOrThrow();
    expect(committed.row_count).toBe(2);
    expect((committed.query_snapshot as { startRow: number }).startRow).toBe(0);

    await db
      .updateTable('integration_sync_runs')
      .set({ available_at: new Date(Date.now() - 1000) })
      .where('id', '=', run.runId)
      .execute();
    expect(await worker.runOnce()).toBe(true);
    const finished = await db
      .selectFrom('integration_sync_runs')
      .select('status')
      .where('id', '=', run.runId)
      .executeTakeFirstOrThrow();
    expect(finished.status).toBe('succeeded');
    expect(offsets).toEqual([0, 2, 2]);
    const pages = await db
      .selectFrom('integration_import_artifacts')
      .select(['query_snapshot', 'row_count'])
      .where('sync_run_id', '=', run.runId)
      .where('dataset', '=', firstDataset.dataset)
      .execute();
    const pageSummary = pages
      .map((page) => ({
        offset: (page.query_snapshot as { startRow: number }).startRow,
        rowCount: page.row_count,
      }))
      .sort((left, right) => left.offset - right.offset);
    expect(pageSummary).toEqual([
      { offset: 0, rowCount: 2 },
      { offset: 2, rowCount: 1 },
    ]);
    const metrics = await db
      .selectFrom('integration_metric_rows as metric')
      .innerJoin(
        'integration_import_artifacts as artifact',
        'artifact.id',
        'metric.source_artifact_id',
      )
      .select(['metric.source_artifact_id'])
      .where('artifact.sync_run_id', '=', run.runId)
      .where('artifact.dataset', '=', firstDataset.dataset)
      .execute();
    expect(metrics).toHaveLength(3);
  });
});
