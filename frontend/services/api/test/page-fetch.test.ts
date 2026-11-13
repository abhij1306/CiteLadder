/**
 * The `page_fetch` task against real PostgreSQL: a recorded site behind
 * Site Health's real acquirer, never the network. A fetched page becomes the
 * chat's page document and queues its first turn; a refused or failed fetch
 * leaves a notice, a snapshot and no turn.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createAgentBindings } from '../src/agent/bindings.ts';
import { AgentOutputs } from '../src/agent/outputs.ts';
import { readChat } from '../src/agent/reads.ts';
import type { AdmittedModel } from '../src/agent/store.ts';
import { pageFetchTask, fetchPage } from '../src/page-documents/fetch-task.ts';
import { PAGE_FETCH_KIND } from '../src/page-documents/keys.ts';
import { fetchedPageContext } from '../src/page-documents/reads.ts';
import type { WebsiteFetcher } from '../src/safe-fetch.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { recordedSite, SiteFixtures, storedFacts, type Served } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
const workspaces: string[] = [];
afterAll(async () => {
  for (const table of ['agent_model_attempts', 'analytics_tasks'] as const)
    if (workspaces.length)
      await db.deleteFrom(table).where('workspace_id', 'in', workspaces).execute();
  await fixtures.cleanup();
  await db.destroy();
});

const PAGE = 'https://example.test/crm-pricing';
const ARTICLE = `<!doctype html><html><head>
<title>CRM pricing compared</title>
<meta name="description" content="Plans and prices for five CRMs.">
<script type="application/ld+json">{"@type":"Article","headline":"CRM pricing"}</script>
</head><body>
<nav><a href="/">Home</a> <a href="/blog">Blog</a></nav>
<main>
<h1>CRM pricing</h1>
<p>Compare <strong>plans</strong> on <a href="/plans">our plans page</a>.</p>
<ul><li>Starter costs $10</li><li>Pro costs $30</li></ul>
</main>
<footer>Copyright Example</footer>
</body></html>`;

/** A crawled project whose content page (a comparison) is PAGE. */
async function project() {
  const seed = await fixtures.crawl();
  workspaces.push(seed.workspaceId);
  const page = await fixtures.page(seed, '/crm-pricing', storedFacts({ title: 'CRM pricing' }));
  await db
    .updateTable('site_page_analyses')
    .set({ page_kind: 'comparison' })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', page.analysisId)
    .execute();
  return seed;
}

async function bindings() {
  const agent = await createAgentBindings(db, {});
  agent.store.dependencies.admission = () =>
    Promise.resolve({ requested_model: 'test-model' } satisfies AdmittedModel);
  return agent;
}

/** Starts an optimize-page chat on PAGE and runs its fetch against `site`. */
async function fetchedChat(site: Record<string, Served>) {
  const seed = await project();
  const agent = await bindings();
  const created = await agent.store.create(seed, {
    message: 'Improve this page so AI answers cite it.',
    key: randomUUID(),
    workflowId: 'optimize_page',
    refs: { target_url: PAGE },
  });
  const fetcher: WebsiteFetcher = recordedSite(site);
  const executors = {
    [PAGE_FETCH_KIND]: pageFetchTask({ fetcher, store: () => Promise.resolve(agent.store) }),
  };
  await drainWorkspace(db, seed.workspaceId, { owner: `page-fetch-${randomUUID()}`, executors });
  return { seed, created, chat: await readChat(db, seed, created.chatId) };
}

const runsOf = (chatId: string) =>
  db
    .selectFrom('agent_runs')
    .select(['status', 'requested_skill_id'])
    .where('chat_id', '=', chatId)
    .execute();
const snapshotsOf = (chatId: string) =>
  db
    .selectFrom('page_snapshots')
    .select(['id', 'outcome', 'outcome_reason', 'http_status', 'page_kind'])
    .where('chat_id', '=', chatId)
    .execute();

describe('reading a fetched page', () => {
  it('reads the main content as Markdown and keeps the SEO fields beside it', async () => {
    const result = await fetchPage(db, PAGE, recordedSite({ '/crm-pricing': { body: ARTICLE } }));
    expect(result.outcome).toBe('fetched');
    if (result.outcome !== 'fetched') return;
    expect(result.document).toEqual({
      kind: 'document',
      title: 'CRM pricing compared',
      body: [
        '# CRM pricing',
        '',
        'Compare **plans** on [our plans page](https://example.test/plans).',
        '',
        '- Starter costs $10',
        '- Pro costs $30',
      ].join('\n'),
      fields: {
        title: 'CRM pricing compared',
        meta_description: 'Plans and prices for five CRMs.',
        json_ld: '{"@type":"Article","headline":"CRM pricing"}',
      },
    });
  });

  it('tells a robots refusal and an HTTP error apart from a fetch failure', async () => {
    const denied = await fetchPage(
      db,
      PAGE,
      recordedSite({
        '/robots.txt': { body: 'User-agent: *\nDisallow: /', contentType: 'text/plain' },
        '/crm-pricing': { body: ARTICLE },
      }),
    );
    expect({
      outcome: denied.outcome,
      reason: denied.outcome === 'fetched' ? null : denied.reason,
    }).toEqual({
      outcome: 'blocked_robots',
      reason: 'robots_denied',
    });
    const gone = await fetchPage(db, PAGE, recordedSite({ '/crm-pricing': { status: 410 } }));
    expect({
      outcome: gone.outcome,
      reason: gone.outcome === 'fetched' ? null : gone.reason,
    }).toEqual({
      outcome: 'http_error',
      reason: 'http_410',
    });
  });
});

describe('the page fetch task', () => {
  it('turns a fetched page into the chat page document and queues exactly one turn', async () => {
    const { created, chat } = await fetchedChat({ '/crm-pricing': { body: ARTICLE } });
    expect(created.run).toBeNull();
    expect(chat.page_fetch).toMatchObject({ status: 'done', outcome: 'fetched' });
    expect(
      chat.outputs.map((output) => ({
        kind: output.kind,
        skill: output.skill_id,
        author: output.latest_revision.author,
        title: output.latest_revision.title,
        fields: output.latest_revision.fields,
      })),
    ).toEqual([
      {
        kind: 'page',
        skill: 'content_optimize',
        author: 'fetch',
        title: 'CRM pricing compared',
        fields: {
          title: 'CRM pricing compared',
          meta_description: 'Plans and prices for five CRMs.',
          json_ld: '{"@type":"Article","headline":"CRM pricing"}',
        },
      },
    ]);
    expect(await runsOf(created.chatId)).toEqual([
      { status: 'queued', requested_skill_id: 'content_optimize' },
    ]);
    expect(await snapshotsOf(created.chatId)).toMatchObject([
      // Classified from this fetch, not copied from the crawl.
      { outcome: 'fetched', outcome_reason: null, http_status: 200, page_kind: 'other' },
    ]);
  });

  it('shows the page-local checks of the fetch on the chat read, failing ones first', async () => {
    const noMeta = ARTICLE.replace(/<meta name="description"[^>]*>/, '');
    const { chat } = await fetchedChat({ '/crm-pricing': { body: noMeta } });
    if (chat.page_fetch?.status !== 'done') throw new Error('Expected a finished fetch');
    const { checks } = chat.page_fetch;
    const shown = (ruleId: string) => checks.find((check) => check.rule_id === ruleId);
    expect({
      meta: shown('technical.meta_description_present'),
      title: shown('technical.title_present'),
      first: checks[0]?.failing,
    }).toEqual({
      meta: {
        rule_id: 'technical.meta_description_present',
        label: 'Missing meta description',
        severity: 'medium',
        outcome: 'missing',
        failing: true,
      },
      title: {
        rule_id: 'technical.title_present',
        label: 'Missing page title',
        severity: 'high',
        outcome: 'satisfied',
        failing: false,
      },
      first: true,
    });
  });

  it('keeps the fetched SEO fields through a person’s edit of the page body', async () => {
    const { seed, created, chat } = await fetchedChat({ '/crm-pricing': { body: ARTICLE } });
    const [document] = chat.outputs;
    if (!document) throw new Error('Expected the page document');
    // The queued first turn ends without changing the document.
    const now = new Date();
    await db
      .updateTable('agent_runs')
      .set({ status: 'cancelled', cancelled_at: now, completed_at: now, updated_at: now })
      .where('chat_id', '=', created.chatId)
      .execute();
    const revision = await new AgentOutputs(db).edit(seed, created.chatId, document.id, {
      baseId: document.latest_revision.id,
      title: 'CRM pricing compared',
      body: '# CRM pricing for small teams',
    });
    expect({ author: revision.author, body: revision.body, fields: revision.fields }).toEqual({
      author: 'user',
      body: '# CRM pricing for small teams',
      fields: {
        title: 'CRM pricing compared',
        meta_description: 'Plans and prices for five CRMs.',
        json_ld: '{"@type":"Article","headline":"CRM pricing"}',
      },
    });
  });

  it('answers a failed fetch with a notice, a snapshot and no turn', async () => {
    const { created, chat } = await fetchedChat({ '/crm-pricing': { status: 404 } });
    expect(chat.page_fetch).toMatchObject({ status: 'done', outcome: 'http_error' });
    expect(chat.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Improve this page so AI answers cite it.'],
      [
        'agent',
        `I couldn’t read ${PAGE}: the site answered with HTTP 404. Check that the page is live. Start a new chat on the page once it can be read.`,
      ],
    ]);
    expect(await snapshotsOf(created.chatId)).toMatchObject([
      { outcome: 'http_error', outcome_reason: 'http_404', http_status: 404, page_kind: null },
    ]);
    // No turn ran, so no model call was reserved or settled.
    expect({ runs: await runsOf(created.chatId), outputs: chat.outputs.length }).toEqual({
      runs: [],
      outputs: 0,
    });
  });

  it('reads a snapshot only in the workspace that fetched it', async () => {
    const { seed, created } = await fetchedChat({ '/crm-pricing': { body: ARTICLE } });
    const [snapshot] = await snapshotsOf(created.chatId);
    if (!snapshot) throw new Error('Expected a snapshot');
    const other = await project();
    expect(await fetchedPageContext(db, other, snapshot.id)).toBeNull();
    expect(await fetchedPageContext(db, seed, snapshot.id)).toMatchObject({
      requested_url: PAGE,
      outcome: 'fetched',
      page_kind: 'other',
    });
  });
});
