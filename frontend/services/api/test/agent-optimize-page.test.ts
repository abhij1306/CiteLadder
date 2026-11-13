/**
 * The Agent's optimize-page workflow through the served chat route (content
 * optimization phase 2, PR 1): a page chat starts only on one of the latest
 * crawl's content pages, commits its page fetch and no turn, and the fetch
 * queues the chat's one first turn. The site is recorded; nothing reaches the
 * network or a model.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { agentChatCreatedSchema, agentChatDetailSchema } from '@citeladder/contracts/agent';
import { createApp } from '../src/app.ts';
import * as bindingsOwner from '../src/agent/bindings.ts';
import { createAgentBindings } from '../src/agent/bindings.ts';
import type { AdmittedModel } from '../src/agent/store.ts';
import { pageFetchTask } from '../src/page-documents/fetch-task.ts';
import { PAGE_FETCH_KIND } from '../src/page-documents/keys.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { recordedSite, SiteFixtures, storedFacts } from './site-health-fixtures.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const db = testDatabase();
const config = testConfig();
const app = createApp(config, db);
const fixtures = new SiteFixtures(db);
const workspaces: string[] = [];
afterAll(async () => {
  vi.restoreAllMocks();
  if (workspaces.length)
    await db.deleteFrom('analytics_tasks').where('workspace_id', 'in', workspaces).execute();
  await fixtures.cleanup();
  await db.destroy();
});

const PAGE = 'https://example.test/crm-pricing';
const ARTICLE =
  '<html><head><title>CRM pricing compared</title></head><body><main><h1>CRM pricing</h1><p>Plans and prices.</p></main></body></html>';

/** A signed-in owner of a crawled project whose one content page is PAGE. */
async function setup() {
  const seed = await fixtures.crawl();
  workspaces.push(seed.workspaceId);
  const page = await fixtures.page(seed, '/crm-pricing', storedFacts({ title: 'CRM pricing' }));
  await db
    .updateTable('site_page_analyses')
    .set({ page_kind: 'comparison' })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', page.analysisId)
    .execute();
  const bindings = await createAgentBindings(db, {});
  bindings.store.dependencies.admission = () =>
    Promise.resolve({
      requested_model: 'test-model',
    } satisfies AdmittedModel);
  vi.spyOn(bindingsOwner, 'agentBindings').mockResolvedValue(bindings);
  const token = await sessionToken({ sub: seed.userId, ver: 0 });
  const headers = {
    cookie: `${TEST_SESSION_COOKIE}=${token}`,
    'X-Workspace-Id': seed.workspaceId,
    'Content-Type': 'application/json',
  };
  const startChat = (targetUrl: string, key = randomUUID()) =>
    app.request(`/api/v1/projects/${seed.projectId}/agent/chats`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify({
        message: 'Improve this page so AI answers cite it.',
        workflow_id: 'optimize_page',
        context: { target_url: targetUrl },
      }),
    });
  const drain = () =>
    drainWorkspace(db, seed.workspaceId, {
      owner: `optimize-page-${randomUUID()}`,
      executors: {
        [PAGE_FETCH_KIND]: pageFetchTask({
          fetcher: recordedSite({ '/crm-pricing': { body: ARTICLE } }),
          store: () => Promise.resolve(bindings.store),
        }),
      },
    });
  return { seed, headers, startChat, drain };
}

const fetchTasks = (workspaceId: string) =>
  db
    .selectFrom('analytics_tasks')
    .select('payload')
    .where('workspace_id', '=', workspaceId)
    .where('task_kind', '=', PAGE_FETCH_KIND)
    .execute();

describe('optimize-page chats', () => {
  it('refuses a page outside the latest crawl content pages and starts on one inside', async () => {
    const { seed, startChat } = await setup();
    const refused = await startChat('https://example.test/about');
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: 'validation_error' } });
    expect(await fetchTasks(seed.workspaceId)).toEqual([]);

    const accepted = await startChat('https://www.example.test/crm-pricing');
    expect(accepted.status).toBe(202);
    const created = agentChatCreatedSchema.parse(await accepted.json());
    expect(created.run).toBeNull();
    // The www twin resolves to the crawl's own page.
    expect((await fetchTasks(seed.workspaceId)).map(({ payload }) => payload)).toMatchObject([
      { chat_id: created.chat_id, url: PAGE, workflow_id: 'optimize_page' },
    ]);
  });

  it('queues exactly one turn once the page is read, and a retried request returns it', async () => {
    const { seed, headers, startChat, drain } = await setup();
    const key = randomUUID();
    const created = agentChatCreatedSchema.parse(await (await startChat(PAGE, key)).json());
    const reading = agentChatDetailSchema.parse(
      await (await app.request(`/api/v1/agent/chats/${created.chat_id}`, { headers })).json(),
    );
    expect({ fetch: reading.page_fetch, run: reading.latest_run }).toEqual({
      fetch: { status: 'reading' },
      run: null,
    });

    await drain();
    const detail = agentChatDetailSchema.parse(
      await (await app.request(`/api/v1/agent/chats/${created.chat_id}`, { headers })).json(),
    );
    expect(detail.page_fetch).toMatchObject({ status: 'done', outcome: 'fetched' });
    expect(detail.latest_run?.status).toBe('queued');
    expect(detail.outputs.map((output) => [output.kind, output.latest_revision.author])).toEqual([
      ['page', 'fetch'],
    ]);

    const replayed = agentChatCreatedSchema.parse(await (await startChat(PAGE, key)).json());
    expect({ chat: replayed.chat_id, run: replayed.run?.id }).toEqual({
      chat: created.chat_id,
      run: detail.latest_run?.id,
    });
    const runs = await db
      .selectFrom('agent_runs')
      .select('id')
      .where('workspace_id', '=', seed.workspaceId)
      .execute();
    expect(runs.map((run) => run.id)).toEqual([detail.latest_run?.id]);
  });
});
