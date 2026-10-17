import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { acquisitionExecutor } from '../src/search-intelligence/executor.ts';
import { createReview } from '../src/search-intelligence/reviews.ts';
import { confirmRun } from '../src/search-intelligence/runs.ts';
import { reviewBody } from '../src/routes/search-intelligence-contracts.ts';
import { createSecretCipher } from '../src/integrations/fernet.ts';
import { WorkspaceScope } from '../src/db/workspace-scope.ts';
import { loadWorkerSettings } from '../src/config.ts';
import { testDatabase } from './support.ts';
import { workspaceTaskIds } from './analytics-drain.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  key = 'worker-test-key',
  connections: string[] = [];
afterAll(async () => {
  if (connections.length)
    await db
      .deleteFrom('provider_capacity_buckets')
      .where('connection_id', 'in', connections)
      .execute();
  await fixtures.cleanup();
  await db.destroy();
});
async function run() {
  const t = await fixtures.tenant({ websiteUrl: 'https://www.example.com' }),
    at = new Date(),
    connectionId = randomUUID();
  connections.push(connectionId);
  await db
    .updateTable('projects')
    .set({ serp_location_code: 2840, serp_language_code: 'en' })
    .where('id', '=', t.projectId)
    .execute();
  await db
    .insertInto('provider_connections')
    .values({
      id: connectionId,
      workspace_id: t.workspaceId,
      label: 'DFS',
      transport_provider: 'dataforseo',
      api_key_encrypted: createSecretCipher(key).encrypt(
        JSON.stringify({ login: `${connectionId}@example.com`, password: 'test' }),
      ),
      base_url: '',
      credential_revision: randomUUID(),
      active: true,
      last_test_status: 'ok',
      created_at: at,
      updated_at: at,
    })
    .execute();
  const scope = { workspace: new WorkspaceScope(t.workspaceId), projectId: t.projectId };
  const review = await createReview(
    db,
    scope,
    t.userId,
    'review',
    reviewBody.parse({ datasets: [{ kind: 'ranking_keywords', depth: 2 }] }),
    key,
  );
  await confirmRun(db, scope, review.id);
  return { ...t, runId: review.id };
}
/** Held to the run's acquisition task. */
async function worker(t: { workspaceId: string }, send: typeof fetch) {
  const taskIds = await workspaceTaskIds(db, t.workspaceId, 'search_intelligence_acquisition');
  return new AnalyticsWorker(db, loadWorkerSettings(), {
    executors: {
      search_intelligence_acquisition: acquisitionExecutor({ send, env: { ENCRYPTION_KEY: key } }),
    },
    taskScope: { workspaceId: t.workspaceId, taskIds },
  });
}
const receipt = () =>
  Response.json({
    status_code: 20000,
    tasks: [
      { status_code: 20000, id: 'receipt', cost: 0.012, result: [{ items: [], total_count: 0 }] },
    ],
  });
describe('native research acquisition worker', () => {
  it('claims once under competing workers and commits an empty paid dataset', async () => {
    const t = await run();
    let sent = 0;
    const send: typeof fetch = async () => {
      sent++;
      return receipt();
    };
    const [first, second] = await Promise.all([worker(t, send), worker(t, send)]);
    await Promise.all([first.runOnce(), second.runOnce()]);
    expect(sent).toBe(1);
    expect(
      await db
        .selectFrom('search_intelligence_runs')
        .selectAll()
        .where('id', '=', t.runId)
        .executeTakeFirst(),
    ).toMatchObject({ status: 'succeeded', completed_calls: 1 });
    expect(
      await db
        .selectFrom('search_intelligence_datasets')
        .select(['status', 'coverage'])
        .where('run_id', '=', t.runId)
        .executeTakeFirst(),
    ).toEqual({ status: 'published', coverage: 'empty' });
    // A published keyword dataset can open or close keyword-gap Actions.
    const refresh = await db
      .selectFrom('analytics_tasks')
      .select('payload')
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', 'opportunity_refresh')
      .executeTakeFirstOrThrow();
    expect(refresh.payload).toMatchObject({ trigger_kind: 'search_intelligence_dataset' });
  });
  it('parks explicit rate limits without spending the queue retry budget', async () => {
    const t = await run();
    let sent = 0;
    const w = await worker(t, async () => {
      sent++;
      return sent === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
        : receipt();
    });
    await w.runOnce();
    const parked = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', 'search_intelligence_acquisition')
      .executeTakeFirstOrThrow();
    expect(parked).toMatchObject({ status: 'retry_wait', attempt_count: 0, lease_owner: null });
    const account = await db
      .selectFrom('search_intelligence_runs')
      .select('account_identity')
      .where('id', '=', t.runId)
      .executeTakeFirstOrThrow();
    // Advance only this disposable account's capacity to its next available tick.
    await db
      .updateTable('provider_capacity_buckets')
      .set(({ ref }) => ({ tokens: ref('capacity'), blocked_until: null }))
      .where('account_pool_identity', '=', account.account_identity)
      .execute();
    // A published keyword dataset queues Opportunity work too; drain, don't take one task.
    await w.runUntilIdle();
    expect(sent).toBe(2);
    expect(
      await db
        .selectFrom('search_intelligence_runs')
        .select('status')
        .where('id', '=', t.runId)
        .executeTakeFirst(),
    ).toEqual({ status: 'succeeded' });
  });
  it('stops an ambiguous paid request and does no further HTTP on replay', async () => {
    const t = await run();
    let sent = 0;
    const w = await worker(t, async () => {
      sent++;
      throw new Error('connection lost');
    });
    await w.runUntilIdle();
    await w.runUntilIdle();
    expect(sent).toBe(1);
    expect(
      await db
        .selectFrom('search_intelligence_runs')
        .select(['status', 'uncertain_calls'])
        .where('id', '=', t.runId)
        .executeTakeFirst(),
    ).toEqual({ status: 'uncertain', uncertain_calls: 1 });
  });
});
