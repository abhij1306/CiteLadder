import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AcquisitionState,
  type PreparedResearch,
} from '../src/search-intelligence/acquisition-state.ts';
import { createReview } from '../src/search-intelligence/reviews.ts';
import { confirmRun } from '../src/search-intelligence/runs.ts';
import { reviewBody } from '../src/routes/search-intelligence-contracts.ts';
import { createSecretCipher } from '../src/integrations/fernet.ts';
import { WorkspaceScope } from '../src/db/workspace-scope.ts';
import { ProviderError } from '../src/answer-engines/contracts.ts';
import { reconcileResearch } from '../src/search-intelligence/maintenance.ts';
import { pageEstimateMicrousd } from '../src/search-intelligence/requests.ts';
import { policy } from '../src/config.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db),
  key = 'state-test-key';
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
async function run(depth = 2) {
  const t = await fixtures.tenant({ websiteUrl: 'https://www.example.com' }),
    at = new Date(),
    connectionId = randomUUID();
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
        JSON.stringify({ login: 'test@example.com', password: 'test' }),
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
    reviewBody.parse({ datasets: [{ kind: 'ranking_keywords', depth }] }),
    key,
  );
  await confirmRun(db, scope, review.id);
  const task = await db
    .selectFrom('analytics_tasks')
    .selectAll()
    .where('workspace_id', '=', t.workspaceId)
    .where('project_id', '=', t.projectId)
    .where('task_kind', '=', 'search_intelligence_acquisition')
    .executeTakeFirstOrThrow();
  const claimed = await db
    .updateTable('analytics_tasks')
    .set({
      status: 'running',
      lease_owner: 'research-test',
      lease_expires_at: new Date(Date.now() + 120000),
    })
    .where('id', '=', task.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  const state = new AcquisitionState(db, claimed, review.id),
    plans = await state.start();
  return { ...t, state, plans: plans!, runId: review.id, task: claimed, connectionId };
}
function dispatched(
  value: PreparedResearch,
): Extract<PreparedResearch, { action: 'dispatch' | 'publish' }> {
  if (value.action !== 'dispatch' && value.action !== 'publish')
    throw new Error('Expected a dispatch');
  return value;
}
const response = {
  body: {
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        id: 'paid-task',
        cost: 0.012,
        result: [
          {
            items: [
              {
                keyword_data: { keyword: 'shoes', keyword_info: { search_volume: 12 } },
                ranked_serp_element: { url: 'https://www.example.com/shoes', rank_group: 1 },
              },
            ],
            total_count: 1,
          },
        ],
      },
    ],
  },
  hash: 'exact-response-hash',
  taskId: 'paid-task',
  cost: '0.012',
};
describe('durable paid acquisition boundaries', () => {
  it('publishes a full page with duplicate rows and keeps exact provenance on replay', async () => {
    const t = await run(1000),
      plan = t.plans[0]!,
      prep = dispatched(await t.state.prepare(plan, 0));
    await t.state.dispatch(prep);
    const items = Array.from({ length: 1000 }, (_, i) => ({
      keyword_data: { keyword: `shoes ${i === 999 ? 0 : i}` },
      ranked_serp_element: { url: 'https://www.example.com/shoes', rank_group: i + 1 },
    }));
    await t.state.saveResponse(prep.call.id, {
      ...response,
      body: { ...response.body, tasks: [{ ...response.body.tasks[0]!, result: [{ items }] }] },
    });
    await t.state.publish(plan, prep.call.id, []);
    const rows = await db
      .selectFrom('search_intelligence_rows')
      .select(['keyword', 'rank_group', 'call_id', 'dataset_id'])
      .where('workspace_id', '=', t.workspaceId)
      .where('dataset_id', '=', prep.dataset.id)
      .execute();
    expect(rows).toHaveLength(999);
    expect(rows.find((row) => row.keyword === 'shoes 0')).toEqual({
      keyword: 'shoes 0',
      rank_group: 1,
      call_id: prep.call.id,
      dataset_id: prep.dataset.id,
    });
    await t.state.publish(plan, prep.call.id, []);
    expect(await t.state.run().executeTakeFirstOrThrow()).toMatchObject({
      completed_calls: 1,
      received_rows: 1000,
    });
  });
  it.each([null, '1.00'])(
    'closes collecting datasets when a saved receipt stops the run (cost %s)',
    async (cost) => {
      const t = await run(),
        plan = t.plans[0]!,
        prep = dispatched(await t.state.prepare(plan, 0));
      await t.state.dispatch(prep);
      const limit = Number((plan.request as Record<string, unknown>).limit);
      const task = response.body.tasks[0]!;
      await t.state.saveResponse(prep.call.id, {
        ...response,
        cost,
        body: {
          ...response.body,
          tasks: [
            {
              ...task,
              result: [
                {
                  items: Array.from({ length: limit }, (_, i) => ({
                    keyword_data: { keyword: `shoes ${i}`, keyword_info: { search_volume: 12 } },
                    ranked_serp_element: {
                      url: 'https://www.example.com/shoes',
                      rank_group: i + 1,
                    },
                  })),
                },
              ],
            },
          ],
        },
      });
      expect(await t.state.publish(plan, prep.call.id, [plan])).toBe(true);
      expect(
        await db
          .selectFrom('search_intelligence_datasets')
          .select(['status', 'coverage', 'unique_rows_saved'])
          .where('id', '=', prep.dataset.id)
          .executeTakeFirst(),
      ).toEqual({ status: 'failed', coverage: 'unknown', unique_rows_saved: limit });
      expect((await t.state.run().executeTakeFirstOrThrow()).status).toBe(
        cost === null ? 'uncertain' : 'partial',
      );
    },
  );
  it('reconciles exhausted analytics leases using saved receipts while keeping missing receipts uncertain', async () => {
    const saved = await run(),
      lost = await run();
    for (const t of [saved, lost]) {
      const prep = dispatched(await t.state.prepare(t.plans[0]!, 0));
      await t.state.dispatch(prep);
      if (t === saved) await t.state.saveResponse(prep.call.id, response);
      await db
        .updateTable('analytics_tasks')
        .set({ status: 'failed', lease_owner: null, lease_expires_at: null })
        .where('id', '=', t.task.id)
        .execute();
    }
    await reconcileResearch(db);
    expect(await saved.state.run().executeTakeFirst()).toMatchObject({
      status: 'partial',
      completed_calls: 1,
      received_rows: 1,
    });
    expect(await lost.state.run().executeTakeFirst()).toMatchObject({
      status: 'uncertain',
      uncertain_calls: 1,
    });
    await reconcileResearch(db);
    expect(await saved.state.run().executeTakeFirst()).toMatchObject({ completed_calls: 1 });
  });
  it('closes a recovered run whose saved receipt the schema refuses', async () => {
    const t = await run(),
      prep = dispatched(await t.state.prepare(t.plans[0]!, 0));
    await t.state.dispatch(prep);
    const task = response.body.tasks[0]!;
    const oversized = {
      keyword_data: { keyword: 'shoes' },
      ranked_serp_element: { url: `https://www.example.com/${'a'.repeat(5000)}`, rank_group: 1 },
    };
    await t.state.saveResponse(prep.call.id, {
      ...response,
      body: { ...response.body, tasks: [{ ...task, result: [{ items: [oversized] }] }] },
    });
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'failed', lease_owner: null, lease_expires_at: null })
      .where('id', '=', t.task.id)
      .execute();
    await reconcileResearch(db);
    // The project is free for a new acquisition; the paid receipt and its cost remain.
    expect(await t.state.run().executeTakeFirst()).toMatchObject({
      status: 'failed',
      provider_reported_cost_usd: '0.01200000',
    });
    expect(await t.state.calls().executeTakeFirst()).toMatchObject({
      status: 'failed',
      error_code: 'normalization_failed',
      response_sha256: response.hash,
    });
  });
  it('never sends a call that could pass the confirmed estimate', async () => {
    const t = await run();
    const { estimated_cost_usd } = await t.state.run().executeTakeFirstOrThrow();
    await db
      .updateTable('search_intelligence_runs')
      .set({ provider_reported_cost_usd: estimated_cost_usd })
      .where('id', '=', t.runId)
      .execute();
    expect((await t.state.prepare(t.plans[0]!, 0)).action).toBe('stop');
    expect(await t.state.run().executeTakeFirst()).toMatchObject({
      status: 'failed',
      error_code: 'cost_ceiling_reached',
    });
  });
  it('sends a short last page after a full first page charged its own price', async () => {
    const t = await run(1001);
    // A full page costs more than the dataset's average per page; that is not overspend.
    const fullPage = (
      pageEstimateMicrousd('ranking_keywords', policy.search_intelligence.page_size) / 1e6
    ).toFixed(6);
    await db
      .updateTable('search_intelligence_runs')
      .set({ provider_reported_cost_usd: fullPage, completed_calls: 1 })
      .where('id', '=', t.runId)
      .execute();
    expect((await t.state.prepare(t.plans[1]!, 1)).action).toBe('dispatch');
  });
  it('stops the run on a refused credential, whether found locally or by the provider', async () => {
    const local = await run(),
      prep = dispatched(await local.state.prepare(local.plans[0]!, 0));
    await local.state.refuse(prep, new ProviderError('auth_failure'));
    expect(await local.state.run().executeTakeFirst()).toMatchObject({
      status: 'failed',
      error_code: 'auth_failure',
      uncertain_calls: 0,
    });
    // Nothing was sent, so there is no dispatch evidence to read as possible spend.
    expect(
      await db
        .selectFrom('search_intelligence_dispatch_attempts')
        .select('id')
        .where('call_id', '=', prep.call.id)
        .execute(),
    ).toEqual([]);

    const remote = await run(),
      sent = dispatched(await remote.state.prepare(remote.plans[0]!, 0));
    await remote.state.dispatch(sent);
    expect(await remote.state.fail(sent, new ProviderError('auth_failure'))).toMatchObject({
      stop: true,
    });
    expect((await remote.state.run().executeTakeFirst())?.error_code).toBe('auth_failure');
  });
  it('recovers a saved response with exact row provenance and settles it once', async () => {
    const t = await run(),
      plan = t.plans[0]!,
      prep = dispatched(await t.state.prepare(plan, 0));
    expect(await t.state.dispatch(prep)).toBe(true);
    await t.state.saveResponse(prep.call.id, response);
    expect((await t.state.prepare(plan, 0)).action).toBe('publish');
    expect(await t.state.publish(plan, prep.call.id, [])).toBe(false);
    await t.state.finish();
    expect(await t.state.run().executeTakeFirst()).toMatchObject({
      status: 'succeeded',
      completed_calls: 1,
      received_rows: 1,
      provider_reported_cost_usd: '0.01200000',
    });
    const rows = await db
      .selectFrom('search_intelligence_rows')
      .selectAll()
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      call_id: prep.call.id,
      dataset_id: prep.dataset.id,
      keyword: 'shoes',
      rank_group: 1,
    });
    expect((await t.state.prepare(plan, 0)).action).toBe('stop');
    expect(await t.state.publish(plan, prep.call.id, [])).toBe(true);
    expect(await t.state.calls().execute()).toHaveLength(1);
  });
  it('never resends a dispatched call without its receipt, including expired lease recovery', async () => {
    const t = await run(),
      plan = t.plans[0]!,
      prep = dispatched(await t.state.prepare(plan, 0));
    await t.state.dispatch(prep);
    await db
      .updateTable('analytics_tasks')
      .set({ lease_expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', t.task.id)
      .execute();
    expect((await t.state.prepare(plan, 0)).action).toBe('stop');
    await db
      .updateTable('analytics_tasks')
      .set({ lease_owner: 'recovery', lease_expires_at: new Date(Date.now() + 120000) })
      .where('id', '=', t.task.id)
      .execute();
    const state = new AcquisitionState(db, { ...t.task, lease_owner: 'recovery' }, t.runId);
    expect((await state.prepare(plan, 0)).action).toBe('stop');
    expect(await state.run().executeTakeFirst()).toMatchObject({
      status: 'uncertain',
      uncertain_calls: 1,
    });
    expect(await state.calls().executeTakeFirst()).toMatchObject({ status: 'uncertain' });
    expect(
      await db
        .selectFrom('search_intelligence_datasets')
        .select(['status', 'coverage'])
        .where('id', '=', prep.dataset.id)
        .executeTakeFirst(),
    ).toEqual({ status: 'failed', coverage: 'unknown' });
    await t.state.saveResponse(prep.call.id, response);
    expect(await state.calls().executeTakeFirst()).toMatchObject({
      status: 'uncertain',
      response_sha256: response.hash,
      provider_reported_cost_usd: '0.01200000',
    });
    expect(await state.run().executeTakeFirst()).toMatchObject({
      status: 'uncertain',
      provider_reported_cost_usd: '0.01200000',
    });
  });
  it('appends bounded explicit rate-limit retries and stops when cost is unavailable', async () => {
    const t = await run(),
      plan = t.plans[0]!;
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const prep = dispatched(await t.state.prepare(plan, 0));
      expect(prep.ordinal).toBe(ordinal);
      await t.state.dispatch(prep);
      const result = await t.state.fail(prep, new ProviderError('rate_limit', false, 7));
      expect(result.wait !== null).toBe(ordinal <= 2);
    }
    await t.state.finish();
    expect(await t.state.run().executeTakeFirst()).toMatchObject({ status: 'partial' });
    const evidence = await db
      .selectFrom('search_intelligence_dispatch_attempts')
      .select(['phase', 'ordinal'])
      .where('call_id', '=', (await t.state.calls().executeTakeFirstOrThrow()).id)
      .execute();
    expect(evidence).toHaveLength(6);
    const other = await run(),
      prep = dispatched(await other.state.prepare(other.plans[0]!, 0));
    await other.state.dispatch(prep);
    await other.state.saveResponse(prep.call.id, { ...response, cost: null });
    expect(await other.state.publish(other.plans[0]!, prep.call.id, [])).toBe(true);
    expect(await other.state.run().executeTakeFirst()).toMatchObject({
      status: 'uncertain',
      error_code: 'provider_cost_unavailable',
    });
  });
});
