/**
 * Analyze a page through the served Actions routes (content optimization
 * phase 2, PR 4): the picker offers only the latest crawl's content pages,
 * the request accepts only such a page and prompts of a topic that has some,
 * reuses the page's Action on a repeat, and starts an `optimize_page` chat
 * whose page fetch hands the chosen prompts to the Agent's context. The site
 * is recorded; nothing reaches the network or a model.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  actionAnalyzeResultSchema,
  actionDetailSchema,
  analyzablePagesSchema,
} from '@citeladder/contracts/actions';
import { agentChatDetailSchema } from '@citeladder/contracts/agent';
import { createApp } from '../src/app.ts';
import * as bindingsOwner from '../src/agent/bindings.ts';
import { createAgentBindings } from '../src/agent/bindings.ts';
import type { AdmittedModel } from '../src/agent/store.ts';
import { pageFetchTask } from '../src/page-documents/fetch-task.ts';
import { PAGE_FETCH_KIND } from '../src/page-documents/keys.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { prompt, promptSet, topic } from './prompt-fixtures.ts';
import { recordedSite, SiteFixtures, storedFacts, type SiteSeed } from './site-health-fixtures.ts';
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

const ARTICLE =
  '<html><head><title>CRM pricing compared</title></head><body><main><h1>CRM pricing</h1><p>Plans and prices.</p></main></body></html>';

async function contentPage(seed: SiteSeed, path: string, kind: string) {
  const page = await fixtures.page(seed, path, storedFacts({ title: path }));
  await db
    .updateTable('site_page_analyses')
    .set({ page_kind: kind })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', page.analysisId)
    .execute();
  await db
    .updateTable('site_urls')
    .set({ latest_title: `Title of ${path}` })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', page.id)
    .execute();
  return page.id;
}

/**
 * A signed-in owner of a crawled project with one content page (a
 * comparison), one product page, a topic with two prompts, a topic with none
 * and a prompt in no topic.
 */
async function setup() {
  const seed = await fixtures.crawl();
  workspaces.push(seed.workspaceId);
  const article = await contentPage(seed, '/crm-pricing', 'comparison');
  const product = await contentPage(seed, '/crm', 'product');
  const set = await promptSet(db, seed.projectId);
  const crm = await topic(db, seed.projectId, 'CRM software');
  const empty = await topic(db, seed.projectId, 'Hiring');
  const prompts = [
    await prompt(db, set, 'best crm for small teams', { topicId: crm }),
    await prompt(db, set, 'cheapest crm', { topicId: crm }),
  ];
  const stray = await prompt(db, set, 'what is a crm');
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
  const analyze = (
    body: { site_url_id: string; topic_id: string; prompt_ids: string[] },
    key = randomUUID(),
  ) =>
    app.request(`/api/v1/projects/${seed.projectId}/actions/analyze`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(body),
    });
  const drain = () =>
    drainWorkspace(db, seed.workspaceId, {
      owner: `analyze-page-${randomUUID()}`,
      executors: {
        [PAGE_FETCH_KIND]: pageFetchTask({
          fetcher: recordedSite({ '/crm-pricing': { body: ARTICLE } }),
          store: () => Promise.resolve(bindings.store),
        }),
      },
    });
  return { seed, headers, analyze, drain, article, product, crm, empty, prompts, stray };
}

const projectActions = (workspaceId: string) =>
  db
    .selectFrom('actions')
    .select(['id', 'target_url', 'origin'])
    .where('workspace_id', '=', workspaceId)
    .execute();

describe('Analyze a page', () => {
  it('offers and accepts only the latest crawl content pages', async () => {
    const { seed, headers, analyze, article, product, crm, prompts } = await setup();
    const listed = analyzablePagesSchema.parse(
      await (
        await app.request(`/api/v1/projects/${seed.projectId}/actions/analyze/pages`, { headers })
      ).json(),
    );
    expect(listed).toEqual({
      crawl_id: seed.crawlId,
      items: [
        {
          site_url_id: article,
          url: 'https://example.test/crm-pricing',
          title: 'Title of /crm-pricing',
          page_kind: 'comparison',
        },
      ],
      truncated: false,
    });
    const searched = analyzablePagesSchema.parse(
      await (
        await app.request(`/api/v1/projects/${seed.projectId}/actions/analyze/pages?q=nothing`, {
          headers,
        })
      ).json(),
    );
    expect(searched.items).toEqual([]);

    const refused = await analyze({ site_url_id: product, topic_id: crm, prompt_ids: prompts });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      error: { message: 'Choose one of the content pages in your latest crawl.' },
    });
    expect(await projectActions(seed.workspaceId)).toEqual([]);

    const accepted = await analyze({ site_url_id: article, topic_id: crm, prompt_ids: prompts });
    expect(accepted.status).toBe(202);
  });

  it('says when the project has no crawl yet', async () => {
    const tenant = await fixtures.tenant();
    workspaces.push(tenant.workspaceId);
    const token = await sessionToken({ sub: tenant.userId, ver: 0 });
    const response = await app.request(
      `/api/v1/projects/${tenant.projectId}/actions/analyze/pages`,
      {
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'X-Workspace-Id': tenant.workspaceId,
        },
      },
    );
    expect(analyzablePagesSchema.parse(await response.json())).toEqual({
      crawl_id: null,
      items: [],
      truncated: false,
    });
  });

  it('refuses a topic without prompts and prompts outside the chosen topic', async () => {
    const { seed, analyze, article, crm, empty, prompts, stray } = await setup();
    const noPrompts = await analyze({ site_url_id: article, topic_id: empty, prompt_ids: prompts });
    expect(noPrompts.status).toBe(422);
    expect(await noPrompts.json()).toMatchObject({
      error: { message: 'This topic has no prompts yet. Choose a topic with prompts.' },
    });
    const foreign = await analyze({
      site_url_id: article,
      topic_id: crm,
      prompt_ids: [prompts[0]!, stray],
    });
    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toMatchObject({
      error: { message: 'Choose prompts from the topic you picked.' },
    });
    expect(await projectActions(seed.workspaceId)).toEqual([]);
  });

  it('reuses the page Action on a repeat and starts a new chat each time', async () => {
    const { seed, analyze, article, crm, prompts } = await setup();
    const first = actionAnalyzeResultSchema.parse(
      await (await analyze({ site_url_id: article, topic_id: crm, prompt_ids: prompts })).json(),
    );
    const key = randomUUID();
    const second = actionAnalyzeResultSchema.parse(
      await (
        await analyze({ site_url_id: article, topic_id: crm, prompt_ids: [prompts[1]!] }, key)
      ).json(),
    );
    const retried = actionAnalyzeResultSchema.parse(
      await (
        await analyze({ site_url_id: article, topic_id: crm, prompt_ids: [prompts[1]!] }, key)
      ).json(),
    );
    expect(await projectActions(seed.workspaceId)).toEqual([
      { id: first.action_id, target_url: 'https://example.test/crm-pricing', origin: 'agent' },
    ]);
    expect([second.action_id, retried.action_id]).toEqual([first.action_id, first.action_id]);
    expect(second.chat_id).not.toBe(first.chat_id);
    expect(retried.chat_id).toBe(second.chat_id);
  });

  it('starts an optimize_page chat whose first turn sees the chosen prompts', async () => {
    const { seed, headers, analyze, drain, article, crm, prompts } = await setup();
    const started = actionAnalyzeResultSchema.parse(
      await (await analyze({ site_url_id: article, topic_id: crm, prompt_ids: prompts })).json(),
    );
    expect(started.run).toBeNull();
    const tasks = await db
      .selectFrom('analytics_tasks')
      .select('payload')
      .where('workspace_id', '=', seed.workspaceId)
      .where('task_kind', '=', PAGE_FETCH_KIND)
      .execute();
    expect(tasks.map(({ payload }) => payload)).toMatchObject([
      {
        chat_id: started.chat_id,
        action_id: started.action_id,
        url: 'https://example.test/crm-pricing',
        site_url_id: article,
        workflow_id: 'optimize_page',
      },
    ]);
    const reading = agentChatDetailSchema.parse(
      await (await app.request(`/api/v1/agent/chats/${started.chat_id}`, { headers })).json(),
    );
    expect(reading.page_fetch).toEqual({ status: 'reading' });
    expect(reading.chat.action_id).toBe(started.action_id);
    expect(reading.messages.map((message) => message.content)).toEqual([
      'Improve this page so AI answers cite it for prompts about CRM software.',
    ]);

    await drain();
    const turn = await db
      .selectFrom('agent_runs')
      .select('context_manifest')
      .where('workspace_id', '=', seed.workspaceId)
      .where('chat_id', '=', started.chat_id)
      .executeTakeFirstOrThrow();
    expect(turn.context_manifest).toMatchObject({
      action: { id: started.action_id },
      package: {
        sections: {
          target_prompts: {
            topic: 'CRM software',
            prompts: ['best crm for small teams', 'cheapest crm'],
            unavailable_prompt_count: 0,
          },
        },
      },
    });
  });

  it('reads the analyzed page Action as an editable page while its page is a content page', async () => {
    const { seed, headers, analyze, article, crm, prompts } = await setup();
    const started = actionAnalyzeResultSchema.parse(
      await (await analyze({ site_url_id: article, topic_id: crm, prompt_ids: prompts })).json(),
    );
    const editable = async () =>
      actionDetailSchema.parse(
        await (await app.request(`/api/v1/actions/${started.action_id}`, { headers })).json(),
      ).editable_page;
    expect(await editable()).toBe(true);
    // The latest crawl now reads the page as a product page: a content kind no longer.
    await db
      .updateTable('site_page_analyses')
      .set({ page_kind: 'product' })
      .where('workspace_id', '=', seed.workspaceId)
      .where('site_url_id', '=', article)
      .execute();
    expect(await editable()).toBe(false);
  });

  it("never reads or attaches another workspace's page, topic or prompts", async () => {
    const owner = await setup();
    const other = await fixtures.crawl();
    workspaces.push(other.workspaceId);
    const token = await sessionToken({ sub: other.userId, ver: 0 });
    const headers = {
      cookie: `${TEST_SESSION_COOKIE}=${token}`,
      'X-Workspace-Id': other.workspaceId,
      'Content-Type': 'application/json',
    };
    const crossed = await app.request(`/api/v1/projects/${other.projectId}/actions/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        site_url_id: owner.article,
        topic_id: owner.crm,
        prompt_ids: owner.prompts,
      }),
    });
    expect(crossed.status).toBe(422);
    const foreignProject = await app.request(
      `/api/v1/projects/${owner.seed.projectId}/actions/analyze/pages`,
      { headers },
    );
    expect(foreignProject.status).toBe(404);
    expect([
      await projectActions(owner.seed.workspaceId),
      await projectActions(other.workspaceId),
    ]).toEqual([[], []]);
  });
});
