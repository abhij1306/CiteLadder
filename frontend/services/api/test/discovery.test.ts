import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.ts';
import { completeDiscovery, createDiscovery, discoveryRow } from '../src/projects/discovery.ts';
import { discoveryComplete, discoveryCreate } from '../src/projects/discovery-inputs.ts';
import { FetchError, type WebsiteFetcher } from '../src/projects/safe-fetch.ts';
import { DiscoveryQueue } from '../src/queue/discovery-queue.ts';
import { recoverDiscoveryLeases } from '../src/queue/recovery.ts';
import { DiscoveryWorker } from '../src/workers/discovery-worker.ts';
import {
  TEST_SESSION_COOKIE,
  Fixtures,
  sessionToken,
  testConfig,
  testDatabase,
} from './support.ts';

const input = discoveryCreate.parse({
  brand_name: 'Acme',
  website_url: 'acme.com',
  primary_market: 'US',
});
const completion = discoveryComplete.parse({
  profile: { category: 'Analytics consultancy' },
  domains: ['acme.com'],
});
const fetcher: WebsiteFetcher = vi.fn(async (url) => ({
  url,
  status: 200,
  contentType: 'text/html',
  body: Buffer.from(
    '<html><head><title>Acme</title></head><body>Analytics services for businesses.</body></html>',
  ),
}));

it('rejects an oversized selected-domain batch before website resolution', () => {
  expect(
    discoveryComplete.safeParse({
      ...completion,
      competitors: [{ name: 'Globex', domains: Array.from({ length: 1000 }, () => 'globex.com') }],
    }).success,
  ).toBe(false);
});

describe('durable onboarding', () => {
  const db = testDatabase();
  const fixtures = new Fixtures(db);
  const workspaces: string[] = [];
  afterEach(async () => {
    if (workspaces.length)
      await db
        .updateTable('brand_discovery_tasks')
        .set({ status: 'succeeded', completed_at: new Date() })
        .where('workspace_id', 'in', workspaces)
        .execute();
  });
  afterAll(async () => {
    await fixtures.cleanup();
    await db.destroy();
  });
  async function tenant() {
    const userId = await fixtures.user();
    const workspaceId = await fixtures.ownedWorkspace(userId);
    workspaces.push(workspaceId);
    return { userId, workspaceId };
  }
  async function ready(workspaceId: string) {
    const row = await createDiscovery(db, workspaceId, input, randomUUID());
    await db
      .insertInto('brand_research_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: workspaceId,
        discovery_id: row.id,
        research_version: '1',
        provider: '',
        model: '',
        method: 'recorded-test',
        extracted_fields: '{}',
        field_confidence: '{}',
        evidence: '[]',
        warnings: '[]',
        created_at: new Date(),
      })
      .execute();
    await db
      .updateTable('brand_discoveries')
      .set({ status: 'ready' })
      .where('id', '=', row.id)
      .execute();
    return row;
  }

  it('admits only the requested workspace discovery once across interactive and background claims', async () => {
    const a = await tenant(),
      b = await tenant();
    const older = await createDiscovery(db, b.workspaceId, input, randomUUID());
    const selected = await createDiscovery(db, a.workspaceId, input, randomUUID());
    const worker = new DiscoveryWorker(db, { fetcher, gateway: null, env: {} });
    const target = { workspaceId: a.workspaceId, discoveryId: selected.id };
    expect(
      await worker.queue.claim('foreign', { ...target, workspaceId: b.workspaceId }),
    ).toBeNull();
    // Keep the other row leased so the background claimant competes for the
    // exact interactive task rather than legitimately taking unrelated work.
    const held = await worker.queue.claim('other-workspace', {
      workspaceId: b.workspaceId,
      discoveryId: older.id,
    });
    expect(held?.discovery_id).toBe(older.id);
    const claims = await Promise.all([
      worker.queue.claim('interactive', target),
      worker.queue.claim('second-tab', target),
      worker.queue.claim('background'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = claims.find((task) => task !== null)!;
    expect(claimed.discovery_id).toBe(selected.id);
    // Finish the contender's lease, then a terminal replay must acquire nothing.
    await worker.finish(claimed, claimed.lease_owner!, null, null);
    expect(await worker.runOnce('replay', target)).toBe(false);
  });

  it('runs a targeted discovery without claiming an older discovery in another workspace', async () => {
    const a = await tenant(),
      b = await tenant();
    const older = await createDiscovery(db, b.workspaceId, input, randomUUID());
    const selected = await createDiscovery(db, a.workspaceId, input, randomUUID());
    const worker = new DiscoveryWorker(db, { fetcher, gateway: null, env: {} });
    const target = { workspaceId: a.workspaceId, discoveryId: selected.id };
    expect(await worker.runOnce('interactive', target)).toBe(true);
    expect((await discoveryRow(db, a.workspaceId, selected.id)).status).toBe('ready');
    expect((await discoveryRow(db, b.workspaceId, older.id)).status).toBe('queued');
    expect(await worker.runOnce('replay', target)).toBe(false);
    expect(
      await db
        .selectFrom('brand_research_snapshots')
        .select('id')
        .where('discovery_id', '=', selected.id)
        .execute(),
    ).toHaveLength(1);
  });

  it('aborts interactive network work and leaves its task available for bounded background retry', async () => {
    const t = await tenant();
    const selected = await createDiscovery(db, t.workspaceId, input, randomUUID());
    const controller = new AbortController();
    const network: WebsiteFetcher = async (_url, options) => {
      controller.abort(new Error('interactive deadline'));
      options.signal!.throwIfAborted();
      throw new Error('unreachable');
    };
    const worker = new DiscoveryWorker(db, { fetcher: network, gateway: null, env: {} });
    const target = { workspaceId: t.workspaceId, discoveryId: selected.id };
    await worker.runOnce('interactive-timeout', target, controller.signal);
    const task = await db
      .selectFrom('brand_discovery_tasks')
      .selectAll()
      .where('discovery_id', '=', selected.id)
      .executeTakeFirstOrThrow();
    expect(task).toMatchObject({ status: 'retry_wait', attempt_count: 1, lease_owner: null });
    expect(await worker.queue.claim('too-early', target)).toBeNull();
    await db
      .updateTable('brand_discovery_tasks')
      .set({ available_at: new Date(0) })
      .where('id', '=', task.id)
      .execute();
    await new DiscoveryWorker(db, { fetcher, gateway: null, env: {} }).runOnce('background-retry');
    expect((await discoveryRow(db, t.workspaceId, selected.id)).status).toBe('ready');
  });

  it('authorizes interactive execution before admission and returns a persisted terminal replay', async () => {
    const a = await tenant(),
      b = await tenant();
    const selected = await ready(a.workspaceId);
    const startRunner = vi.fn(async () => {});
    const app = createApp(testConfig(), db, { startRunner });
    const headers = {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: b.userId, ver: 0 })}`,
    };
    const url = `/api/v1/brand-discoveries/${selected.id}/run`;
    expect((await app.request(url, { method: 'POST', headers })).status).toBe(404);
    const viewer = await fixtures.user();
    await fixtures.member(a.workspaceId, viewer, 'viewer');
    headers.cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: viewer, ver: 0 })}`;
    expect((await app.request(url, { method: 'POST', headers })).status).toBe(403);
    headers.cookie = `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: a.userId, ver: 0 })}`;
    const response = await app.request(url, { method: 'POST', headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: selected.id, status: 'ready' });
    expect(startRunner).not.toHaveBeenCalled();
  });

  it('freezes configured attempts on creation and preserves them on idempotent replay', async () => {
    const t = await tenant();
    const key = randomUUID();
    vi.stubEnv('BRAND_DISCOVERY_MAXIMUM_ATTEMPTS', '7');
    try {
      const created = await createDiscovery(db, t.workspaceId, input, key);
      vi.stubEnv('BRAND_DISCOVERY_MAXIMUM_ATTEMPTS', '9');
      expect((await createDiscovery(db, t.workspaceId, input, key)).id).toBe(created.id);
      const task = await db
        .selectFrom('brand_discovery_tasks')
        .selectAll()
        .where('workspace_id', '=', t.workspaceId)
        .where('discovery_id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(task).toMatchObject({ max_attempts: 7, status: 'queued', attempt_count: 0 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('bounds active and daily discoveries per workspace while replays stay free', async () => {
    const [t, other] = [await tenant(), await tenant()];
    vi.stubEnv('ABUSE_ACTIVE_BRAND_DISCOVERIES_PER_WORKSPACE', '2');
    vi.stubEnv('ABUSE_BRAND_DISCOVERIES_PER_WORKSPACE_DAILY', '3');
    try {
      const key = randomUUID();
      const first = await createDiscovery(db, t.workspaceId, input, key);
      await createDiscovery(db, t.workspaceId, input, randomUUID());
      await expect(createDiscovery(db, t.workspaceId, input, randomUUID())).rejects.toMatchObject({
        status: 429,
      });
      expect((await createDiscovery(db, t.workspaceId, input, key)).id).toBe(first.id);
      await db
        .updateTable('brand_discovery_tasks')
        .set({ status: 'succeeded' })
        .where('workspace_id', '=', t.workspaceId)
        .execute();
      await createDiscovery(db, t.workspaceId, input, randomUUID());
      // The daily window counts every admitted discovery, finished or not.
      await expect(createDiscovery(db, t.workspaceId, input, randomUUID())).rejects.toMatchObject({
        status: 429,
      });
      expect((await createDiscovery(db, other.workspaceId, input, randomUUID())).status).toBe(
        'queued',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reclaims leases once across sweepers, bounds batches and atomically reconciles exhausted parents', async () => {
    const first = await tenant(),
      second = await tenant();
    const retry = await createDiscovery(db, first.workspaceId, input, randomUUID());
    const failed = await createDiscovery(db, second.workspaceId, input, randomUUID());
    const completed = await ready(second.workspaceId);
    const ids = [retry.id, failed.id, completed.id];
    await db
      .updateTable('brand_discovery_tasks')
      .set({
        status: 'running',
        lease_owner: 'dead-worker',
        lease_expires_at: new Date(Date.now() - 1000),
        attempt_count: 1,
        max_attempts: 2,
      })
      .where('discovery_id', 'in', ids)
      .execute();
    await db
      .updateTable('brand_discovery_tasks')
      .set({ attempt_count: 0 })
      .where('discovery_id', '=', retry.id)
      .execute();
    const stale = await db
      .selectFrom('brand_discovery_tasks')
      .selectAll()
      .where('discovery_id', '=', retry.id)
      .executeTakeFirstOrThrow();
    const counts = await Promise.all([
      recoverDiscoveryLeases(db, 1),
      recoverDiscoveryLeases(db, 1),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    expect(await recoverDiscoveryLeases(db, 1)).toBe(1);
    expect(await recoverDiscoveryLeases(db)).toBe(0);
    const tasks = await db
      .selectFrom('brand_discovery_tasks')
      .select(['discovery_id', 'status', 'attempt_count', 'lease_owner', 'completed_at'])
      .where('discovery_id', 'in', ids)
      .execute();
    expect(tasks.find((task) => task.discovery_id === retry.id)).toMatchObject({
      status: 'retry_wait',
      attempt_count: 1,
      lease_owner: null,
      completed_at: null,
    });
    expect(tasks.find((task) => task.discovery_id === failed.id)).toMatchObject({
      status: 'failed',
      attempt_count: 2,
      lease_owner: null,
    });
    expect(await discoveryRow(db, second.workspaceId, failed.id)).toMatchObject({
      status: 'failed',
      warnings: ['research_degraded'],
    });
    expect(await discoveryRow(db, second.workspaceId, completed.id)).toMatchObject({
      status: 'ready',
    });
    const queue = new DiscoveryQueue(db, 30, () => new Date(Date.now() - 86400000));
    expect(await queue.heartbeat(stale, 'dead-worker')).toBe(false);
    expect(await queue.lockedTask(db, stale, 'dead-worker')).toBeUndefined();
  });
  it('rejects completion without persisted research and overlapping competitor domains', async () => {
    const t = await tenant();
    const missing = await createDiscovery(db, t.workspaceId, input, randomUUID());
    await db
      .updateTable('brand_discoveries')
      .set({ status: 'ready' })
      .where('id', '=', missing.id)
      .execute();
    await expect(
      completeDiscovery(db, t.workspaceId, t.userId, missing.id, completion, randomUUID()),
    ).rejects.toMatchObject({ status: 409, message: 'Discovery research evidence is unavailable' });
    const row = await ready(t.workspaceId);
    await expect(
      completeDiscovery(
        db,
        t.workspaceId,
        t.userId,
        row.id,
        discoveryComplete.parse({
          ...completion,
          competitors: [
            { name: 'Globex', domains: ['globex.com'] },
            { name: 'Other name', domains: ['www.globex.com'] },
          ],
        }),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await discoveryRow(db, t.workspaceId, row.id)).project_id).toBeNull();
  });
  it('accepts concurrent idempotent requests once with one committed queue row', async () => {
    const t = await tenant();
    const key = randomUUID();
    const rows = await Promise.all([
      createDiscovery(db, t.workspaceId, input, key),
      createDiscovery(db, t.workspaceId, input, key),
    ]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    const tasks = await db
      .selectFrom('brand_discovery_tasks')
      .selectAll()
      .where('discovery_id', '=', rows[0]!.id)
      .execute();
    expect(tasks).toHaveLength(1);
  });
  it('scopes discovery routes to the workspace and its writers over HTTP', async () => {
    const a = await tenant(),
      b = await tenant();
    const app = createApp(testConfig(), db, { startRunner: vi.fn(async () => {}) });
    const as = async (userId: string) => ({
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: userId, ver: 0 })}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    });
    const queued = await createDiscovery(db, a.workspaceId, input, randomUUID());
    const reviewed = await ready(a.workspaceId);
    const read = (id: string, userId: string) =>
      as(userId).then((headers) => app.request(`/api/v1/brand-discoveries/${id}`, { headers }));
    const complete = (id: string, userId: string, body: unknown) =>
      as(userId).then((headers) =>
        app.request(`/api/v1/brand-discoveries/${id}/complete`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      );
    expect((await read(queued.id, a.userId)).status).toBe(200);
    expect((await read(queued.id, b.userId)).status).toBe(404);
    const viewer = await fixtures.user();
    await fixtures.member(a.workspaceId, viewer, 'viewer');
    const create = await app.request('/api/v1/brand-discoveries', {
      method: 'POST',
      headers: await as(viewer),
      body: JSON.stringify(input),
    });
    expect(create.status).toBe(403);
    expect((await complete(reviewed.id, viewer, completion)).status).toBe(403);
    const six = Array.from({ length: 6 }, (_, index) => ({
      name: `Peer ${index}`,
      domains: [`peer-${index}.example`],
    }));
    expect(
      (await complete(reviewed.id, a.userId, { ...completion, competitors: six })).status,
    ).toBe(422);
    expect((await complete(queued.id, a.userId, completion)).status).toBe(409);
    expect((await discoveryRow(db, a.workspaceId, reviewed.id)).project_id).toBeNull();
  });
  it('completes once atomically without prompts or a crawl and freezes reviewed input', async () => {
    const t = await tenant();
    const row = await ready(t.workspaceId);
    const key = randomUUID();
    const outcomes = await Promise.all([
      completeDiscovery(db, t.workspaceId, t.userId, row.id, completion, key),
      completeDiscovery(db, t.workspaceId, t.userId, row.id, completion, key),
    ]);
    expect(outcomes[0]!.project_id).toBe(outcomes[1]!.project_id);
    const projectId = outcomes[0]!.project_id!;
    const sets = await db
      .selectFrom('prompt_sets')
      .selectAll()
      .where('project_id', '=', projectId)
      .execute();
    expect(sets).toHaveLength(1);
    expect(
      await db
        .selectFrom('prompts')
        .select('id')
        .where('prompt_set_id', '=', sets[0]!.id)
        .execute(),
    ).toEqual([]);
    expect(
      await db.selectFrom('site_crawls').select('id').where('project_id', '=', projectId).execute(),
    ).toEqual([]);
    const profile = await db
      .selectFrom('brand_profiles')
      .select('business_context')
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    expect(profile.business_context).toMatchObject({
      category: 'Analytics consultancy',
      field_sources: { category: 'reviewed', primary_market: 'reviewed' },
    });
    await expect(
      completeDiscovery(db, t.workspaceId, t.userId, row.id, completion, 'different'),
    ).rejects.toMatchObject({ status: 409 });
    // Deleting the project removes the research that created it.
    await db.deleteFrom('projects').where('id', '=', projectId).execute();
    await expect(discoveryRow(db, t.workspaceId, row.id)).rejects.toMatchObject({ status: 404 });
  });
  it('creates the project with reviewed competitors without fetching their websites', async () => {
    const t = await tenant();
    const row = await ready(t.workspaceId);
    const selected = discoveryComplete.parse({
      ...completion,
      competitors: [{ name: 'Globex', domains: ['www.globex.com'] }],
    });
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await completeDiscovery(
        db,
        t.workspaceId,
        t.userId,
        row.id,
        selected,
        randomUUID(),
      );
      expect(result.project_id).not.toBeNull();
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
    expect((await discoveryRow(db, t.workspaceId, row.id)).competitors).toEqual([
      { name: 'Globex', aliases: [], domains: ['globex.com'] },
    ]);
  });
  it('research persists a degraded review and immutable provenance using recorded responses', async () => {
    const t = await tenant();
    const row = await createDiscovery(db, t.workspaceId, input, randomUUID());
    const worker = new DiscoveryWorker(db, { fetcher, gateway: null, env: {} });
    await worker.runOnce('test-worker');
    const after = await discoveryRow(db, t.workspaceId, row.id);
    expect(after).toMatchObject({ status: 'ready', project_id: null });
    expect(after.warnings).toContain('research_degraded');
    const snapshot = await db
      .selectFrom('brand_research_snapshots')
      .selectAll()
      .where('discovery_id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(snapshot.extracted_fields).toMatchObject({
      evidence_manifest: expect.arrayContaining([
        expect.objectContaining({ source_url: 'https://acme.com/' }),
      ]),
    });
    expect(await worker.runOnce('test-worker')).toBe(false);
  });
  it('claimers do not share a task and expired owners cannot write terminal results', async () => {
    const t = await tenant();
    const row = await createDiscovery(db, t.workspaceId, input, randomUUID());
    const queue = new DiscoveryQueue(db, 30);
    const claimed = await Promise.all([queue.claim('one'), queue.claim('two')]);
    const task = claimed.find((item) => item?.discovery_id === row.id)!;
    expect(claimed.filter((item) => item?.id === task.id)).toHaveLength(1);
    expect(await queue.heartbeat(task, task.lease_owner!)).toBe(true);
    await db
      .updateTable('brand_discovery_tasks')
      .set({ lease_expires_at: new Date(Date.now() - 1) })
      .where('id', '=', task.id)
      .execute();
    expect(await queue.heartbeat(task, task.lease_owner!)).toBe(false);
    const worker = new DiscoveryWorker(db, { fetcher, gateway: null, env: {} });
    await worker.finish(task, task.lease_owner!, null, new FetchError('site_not_found'));
    expect((await discoveryRow(db, t.workspaceId, row.id)).status).toBe('queued');
  });
  it('loses write permission when the lease expires while waiting for a discovery lock', async () => {
    const t = await tenant();
    const row = await createDiscovery(db, t.workspaceId, input, randomUUID());
    const worker = new DiscoveryWorker(db, { fetcher, gateway: null, env: {} });
    const task = (await worker.queue.claim('blocked-worker'))!;
    await db
      .updateTable('brand_discovery_tasks')
      .set({ lease_expires_at: new Date(Date.now() + 400) })
      .where('id', '=', task.id)
      .execute();
    let finish: Promise<void> | undefined;
    await db.transaction().execute(async (trx) => {
      await discoveryRow(trx, t.workspaceId, row.id, true);
      finish = worker.finish(task, 'blocked-worker', null, new FetchError('site_not_found'));
      await sleep(600);
    });
    await finish;
    expect((await discoveryRow(db, t.workspaceId, row.id)).status).toBe('queued');
    expect(
      (
        await db
          .selectFrom('brand_discovery_tasks')
          .select('status')
          .where('id', '=', task.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('running');
  });
  it('retries transport failures without exposing provider errors and keeps the runner for the retry', async () => {
    const t = await tenant();
    const row = await createDiscovery(db, t.workspaceId, input, randomUUID());
    const worker = new DiscoveryWorker(db, { fetcher, gateway: null, env: {} });
    const task = (await worker.queue.claim('retry-worker', {
      workspaceId: t.workspaceId,
      discoveryId: row.id,
    }))!;
    await worker.finish(task, 'retry-worker', null, new Error('secret provider response'));
    const retry = await db
      .selectFrom('brand_discovery_tasks')
      .selectAll()
      .where('id', '=', task.id)
      .executeTakeFirstOrThrow();
    expect(retry).toMatchObject({ status: 'retry_wait', attempt_count: 1, lease_owner: null });
    // The runner lane waits for a retry due soon instead of idling until the tick.
    const due = await worker.queue.nextDue();
    expect(due!.getTime()).toBeLessThanOrEqual(retry.available_at.getTime());
    await db
      .updateTable('brand_discovery_tasks')
      .set({ available_at: new Date(), max_attempts: 2 })
      .where('id', '=', task.id)
      .execute();
    const final = (await worker.queue.claim('final-worker', {
      workspaceId: t.workspaceId,
      discoveryId: row.id,
    }))!;
    await worker.finish(final, 'final-worker', null, new Error('another secret failure'));
    const failed = await discoveryRow(db, t.workspaceId, row.id);
    expect(failed.status).toBe('failed');
    expect(JSON.stringify([failed, retry])).not.toMatch(/secret/);
  });
});
